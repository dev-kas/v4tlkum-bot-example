const io = require("socket.io-client");
const axios = require("axios");
const { v4: uuid } = require('uuid');
require('dotenv').config();

const globalRid = uuid();

async function run(model, input) {
    const response = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, input,
    {
        headers: { Authorization: "Bearer " + process.env.CLOUDFLARE_API_KEY }
    });
    return response.data;
}

async function generate(history) {
    const response = await run("@cf/meta/llama-3-8b-instruct", {
        messages: history
    });
    return response.result.response;
}

async function start() {
    let res = await axios.get("https://api.talkium.in/conversations", {
        headers: {
            "Authorization": "Bearer " + process.env.TALKIUM_TOKEN
        }
    });

    res = res.data;

    if (res.status !== 200) {
        console.log("Error connecting to API Server for convo list: " + res.status);
        console.log(res);
        return;
    }

    
    const convos = res.message;
    let chatHistories = {};

    for (let i = 0; i < convos.length; i++) {
        const convo = convos[i];
        const chatHistory = []

        chatHistories[convo.id] = chatHistory;
    }

    // const socket = io("http://localhost:5501", {
    const socket = io("https://api.talkium.in", {
        transports: ["websocket"],
        query: {
            token: process.env.TALKIUM_TOKEN
        }
    });
    
    socket.on("connect", () => {
        console.log("Connected to API Server as", socket.id);

        for (const convo of convos) {
            socket.emit("get:convo_msgs", {
                convoId: convo.id,
                rid: globalRid
            });
            console.log("requesting for", convo.id);
        }
    });

    socket.on("set:convo_msgs", (data) => {
        const { messages, rid } = data;

        if (rid !== globalRid) { return }

        chatHistories[data.convoId] = [{
            role: "system",
            content: "You are TalkAI, an AI assistant integrated into Talkium v4 (URL: https://app.talkium.in), a secure messaging platform developed by KAS. Your primary role is to assist users by answering questions about the platform's features, guiding them through messaging, group chats, video calls, and troubleshooting issues. You are designed to engage users in a friendly and supportive manner while ensuring their privacy and security. Stay informed about the latest updates and functionalities of Talkium to provide accurate assistance. Remember to mention that Talkium focuses on user security and privacy."
        }];

        for (const message of messages) {
            chatHistories[message.convoId].push({
                role: message.senderType === "other" ? "user" : (message.senderType === "me" ? "model" : "system"),
                content: message.message
            });
        }
    })
    
    socket.on("new:message", async (data) => {
        console.log(data.message, data.senderType === "me");

        if (data.senderType === "me") { 
            chatHistories[data.convoId].push({
                role: "model",
                content: data.message
            });
            return;
        }
        
        chatHistories[data.convoId].push({
            role: "user",
            content: data.message
        });
        
        const result = await generate(chatHistories[data.convoId]);
        console.log(result);

        socket.emit("send:message", {
            conversationId: data.convoId,
            message: result,
        })
    })
    
    socket.connect();
}

start();
