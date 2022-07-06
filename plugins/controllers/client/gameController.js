const { database } = require("../../../app");
const { Profile, Language, Account, Edition, Customization, Storage, Character, Health, Weaponbuild, Quest } = require("../../models");
const { getCurrentTimestamp, logger, FastifyResponse, writeFile, stringify, readParsed } = require("../../utilities");


class GameController {
    // JET Basics //
    static modeOfflinePatches = async (_request = null, reply = null) => {
        return FastifyResponse.zlibJsonReply(reply, database.core.serverConfig.Patches);
    };

    static modeOfflinePatchNodes = async (_request = null, reply = null) => {
        return FastifyResponse.zlibJsonReply(reply, database.core.serverConfig.PatchNodes);
    };
    // Game //

    static clientGameStart = async (request = null, reply = null) => {
        let playerProfile = Profile.get(await FastifyResponse.getSessionID(request));
        if (playerProfile) {
            return FastifyResponse.zlibJsonReply
                (
                    reply,
                    FastifyResponse.applyBody
                        (
                            { utc_time: Date.now() / 1000 },
                            0,
                            null
                        )
                );
        } else {
            return FastifyResponse.zlibJsonReply
                (
                    reply,
                    FastifyResponse.applyBody
                        (
                            { utc_time: Date.now() / 1000 },
                            999,
                            "Profile Not Found!!"
                        )
                );
        }
    };

    static clientGameVersionValidate = async (request = null, reply = null) => {
        logger.logInfo("Client connected with version: " + request.body.version.major);
        await FastifyResponse.zlibJsonReply
            (
                reply,
                FastifyResponse.applyBody(null)
            );
    };

    static clientGameConfig = async (request = null, reply = null) => {
        const sessionID = await FastifyResponse.getSessionID(request);
        const responseObject = {
            aid: sessionID,
            lang: "en",
            languages: await Language.getAllWithoutKeys(),
            ndaFree: false,
            taxonomy: 6,
            activeProfileId: "pmc" + sessionID,
            backend: {
                Trading: FastifyResponse.getBackendURL(),
                Messaging: FastifyResponse.getBackendURL(),
                Main: FastifyResponse.getBackendURL(),
                RagFair: FastifyResponse.getBackendURL()
            },
            utc_time: getCurrentTimestamp(),
            totalInGame: 0,
            reportAvailable: true,
            twitchEventMember: false,
        };
        /* 
        nickname: "user",
        token: sessionID,
        queued: false,
        banTime: 0,
        hash: "BAN0",
        */

        await FastifyResponse.zlibJsonReply
            (
                reply,
                FastifyResponse.applyBody(responseObject)
            );
    };

    static clientGameKeepAlive = async (request = null, reply = null) => {
        let msg = "OK";

        const sessionID = await FastifyResponse.getSessionID(request);
        if (typeof sessionID == "undefined") msg = "No Session";

        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody({ msg: msg, utc_time: getCurrentTimestamp() })
        );
    };

    static clientProfileList = async (request = null, reply = null) => {
        const output = [];
        const dummyScavData = readParsed("./scavDummy.json");
        dummyScavData.aid = "scav" + await FastifyResponse.getSessionID(request);

        const playerAccount = await Account.get(await FastifyResponse.getSessionID(request));
        if (!playerAccount.wipe) {
            const profile = await playerAccount.getProfile();
            if (profile.character.length !== 0) {
                const character = await profile.getPmc();
                const pmc = await character.dissolve();
                output.push(pmc);
                //output.push(await profile.getScav());
                output.push(dummyScavData);
            }
        }
        //console.log(output);
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(output)
        );
    };

    static clientProfileSelect = async (request = null, reply = null) => {
        const sessionID = await FastifyResponse.getSessionID(request);
        const output = {
            "status": "ok",
            "notifier": FastifyResponse.getNotifier(sessionID),
            "notifierServer": FastifyResponse.getNotifier(sessionID).notifierServer
        };
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(output)
        );
    };

    static clientGameProfileNicknameReserved = async (_request = null, reply = null) => {
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody("")
        )
    }

    static clientGameProfileNicknameValidate = async (request = null, reply = null) => {
        const validate = await Account.ifAvailableNickname(request.body.nickname);
        const response = database.core.serverConfig.translations

        if (validate === true) {
            return FastifyResponse.zlibJsonReply(
                reply,
                FastifyResponse.applyBody({ status: "ok" })
            );
        } else {
            return FastifyResponse.zlibJsonReply(
                reply,
                FastifyResponse.applyBody(null, 255, response.alreadyInUse)
            );
        }
    };

    static clientGameProfileCreate = async (request = null, reply = null) => {
        const sessionID = await FastifyResponse.getSessionID(request);
        const playerAccount = await Account.get(sessionID);
        if (!playerAccount) {
            logger.logDebug("[clientGameProfileCreate] Invalid player account.");
            return;
        }

        const voice = await Customization.get(request.body.voiceId);

        const chosenSide = request.body.side.toLowerCase();
        const chosenSideCapital = chosenSide.charAt(0).toUpperCase() + chosenSide.slice(1);

        const profile = new Profile(playerAccount.id);
        const character = await playerAccount.edition.getCharacterTemplateBySide(chosenSide).solvedClone();
        character._id = "pmc" + playerAccount.id;
        character.aid = playerAccount.id;
        character.savage = "scav" + playerAccount.id;
        character.Info = {};
        character.Info.Side = chosenSideCapital;
        character.Info.Nickname = request.body.nickname;
        character.Info.LowerNickname = request.body.nickname.toLowerCase();
        character.Info.Voice = voice._name;
        character.Info.RegistrationDate = ~~(new Date() / 1000);
        character.Health.UpdateTime = ~~(Date.now() / 1000);

        character.Customization.Head = await Customization.get(request.body.headId);

        profile.character = character;

        profile.storage = {
            _id: character._id,
            suites: playerAccount.edition.storage[chosenSide]
        };
        playerAccount.wipe = false;

        // we create the userbuilds file

        const userBuilds = new Weaponbuild(playerAccount.id);

        await Promise.all([
            profile.save(),
            playerAccount.save(),
            userBuilds.save()
        ]);

        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody({ uid: "pmc" + sessionID })
        );
    };

    static clientGameProfileVoiceChange = async (request = null, reply = null) => {
        const playerProfile = await Profile.get(await FastifyResponse.getSessionID(request));
        playerProfile.character.Info.Voice = request.body.voice;
        await playerProfile.save();
        return FastifyResponse.zlibJsonReply(
            reply,
            FastifyResponse.applyBody(null)
        );
    };

    static clientGameProfileAcceptQuest = async (request = null, reply = null) => {
        const playerProfile = await Profile.get(await FastifyResponse.getSessionID(request));
        const quest = await Quest.get(request.body.data[0].qid);
        await playerProfile.character.addQuest(quest);
        await playerProfile.save();
        console.log()
    };
}
module.exports.GameController = GameController;