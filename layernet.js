const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');
const readline = require('readline');

const uri = 'wss://tongame-service-roy7ocqnoq-ew.a.run.app/socket.io/?EIO=4&transport=websocket';
const options = (accessToken) => ({
    headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Origin': 'https://netcoin.layernet.ai',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; M2012K11AG Build/TKQ1.220829.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version': '13'
    }
});

const logLines = {};

function getRandomColor() {
    const colors = [
        '\x1b[31m', // Red
        '\x1b[32m', // Green
        '\x1b[33m', // Yellow
        '\x1b[34m', // Blue
        '\x1b[35m', // Magenta
        '\x1b[36m', // Cyan
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function logMessage(accountNumber, message) {
    const durabilityColor = getRandomColor();
    const goldColor = getRandomColor();
    const progressColor = getRandomColor();
    const rankColor = getRandomColor();
    const perHourColor = getRandomColor();
    const dogsColor = getRandomColor(); // New color for Dogs
    const resetColor = '\x1b[0m';

    message = message.replace(/Durability: (\d+)/, `${durabilityColor}Durability: $1${resetColor}`);
    message = message.replace(/Gold: (\d+)/, `${goldColor}Gold: $1${resetColor}`);
    message = message.replace(/Progress: ([\d.]+)/, `${progressColor}Progress: $1${resetColor}`);
    message = message.replace(/Rank: ([\w]+)/, `${rankColor}Rank: $1${resetColor}`); // Updated regex for Rank
    message = message.replace(/Per Hour: ([\d.]+)/, `${perHourColor}Per Hour: $1${resetColor}`);
    message = message.replace(/Dogs: (\d+)/, `${dogsColor}Dogs: $1${resetColor}`); // New regex for Dogs

    logLines[accountNumber] = message;
    updateConsole();
}

function updateConsole() {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
    Object.keys(logLines).forEach(accountNumber => {
        console.log(logLines[accountNumber]);
    });
}

fs.readFile('tokens.txt', 'utf8', async (err, data) => {
    if (err) {
        console.error('Failed to read tokens file:', err);
        return;
    }

    const tokens = data.split('\n').filter(token => token.trim().length > 0);

    await Promise.all(tokens.map((token, index) => 
        new Promise((resolve) => {
            setTimeout(() => {
                connect(token.trim(), index + 1, resolve); // Pass the resolve function to connect
            }, index * 5000); // Delay of 5 seconds between each connection
        })
    ));

    logMessage('All accounts connected.');
});

async function connect(accessToken, accountNumber, resolve) {
    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    let eventTypeNumber = 0;
    let totalCoinsEarned = 0;
    let currentRound = 5;
    let gameStarted = false;
    let homeDataSent = false;
    let isSendingMessage = false;
    let shouldSendInGameMessages = true;

    // Object to store user rank data
    const userRankData = {};

    function attachWebSocketHandlers() {
        ws.on('open', function open() {
            logMessage(accountNumber, `Account #${accountNumber} | WebSocket connection opened for token: ${accessToken}`);
            reconnectAttempts = 0;
            ws.send('40{"token": "Bearer ' + accessToken + '"}');
        });

        ws.on('message', function incoming(data) {
            const message = data.toString();
            const typeMatch = message.match(/^(\d+)/);
            if (typeMatch) {
                const type = typeMatch[1];
                const content = message.substring(type.length);
                try {
                    if (content.startsWith('[') || content.startsWith('{')) {
                        const json = JSON.parse(content);
                        if (Array.isArray(json) && json.length > 0) {
                            const data = json[0];
                            if (data.userRank) {
                                // Store user rank data
                                userRankData.rank = data.userRank.role;
                                userRankData.profitPerHour = data.userRank.profitPerHour;
                                userRankData.gold = data.gold;
                                userRankData.dogs = data.dogs;

                                logMessage(accountNumber, `Account #${accountNumber} | Rank: ${userRankData.rank} | Per Hour: ${userRankData.profitPerHour} | Gold: ${(userRankData.gold / 1000).toFixed(3)} | Dogs: ${userRankData.dogs}`);
                            }
                            if (!gameStarted) {
                                logMessage(accountNumber, `Account #${accountNumber} | Starting game...`);
                                startGame();
                                gameStarted = true;
                            }
                        }
                        if (json[0] && json[0].duration) {
                            const gameData = json[0];
                            logMessage(accountNumber, `Account #${accountNumber} | Durability: ${gameData.durability} | Gold: ${gameData.gold} | Rank: ${userRankData.rank} | Per Hour: ${userRankData.profitPerHour} | Dogs: ${userRankData.dogs}`);
                            
                            if (gameData.durability === 0 && gameData.gameover) {
                                logMessage(accountNumber, `Account #${accountNumber} | Game Selesai | Coin: ${gameData.gold}`);
                                totalCoinsEarned += gameData.gold;
                                currentRound = 5;
                                eventTypeNumber = 0;
                                gameStarted = false;
                                startGame();
                            } else if (gameData.durability >= 0) {
                                sendInGameMessage(gameData);
                            }
                        }
                    } else {
                        logMessage(accountNumber, `Account #${accountNumber} | Non-JSON Message Content: ${content}`);
                    }
                } catch (err) {
                    logMessage(accountNumber, `Account #${accountNumber} | Failed to parse JSON: ${err}`);
                }
            } else {
                logMessage(accountNumber, `Account #${accountNumber} | Failed to extract type from message: ${message}`);
            }

            if (message.includes('40') && !homeDataSent) {
                sendHomeData();
                homeDataSent = true;
            }
        });

        ws.on('error', function error(err) {
            logMessage(accountNumber, `Account #${accountNumber} | WebSocket error for token: ${accessToken} ${err}`);
        });

        ws.on('close', function close(code, reason) {
            logMessage(accountNumber, `Account #${accountNumber} | WebSocket connection closed for token: ${accessToken}`);
            logMessage(accountNumber, 'Close code: ' + code);
            logMessage(accountNumber, 'Close reason: ' + (reason ? reason.toString() : 'No reason provided'));
            shouldSendInGameMessages = false;
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(reconnect, 5000);
            } else {
                logMessage(accountNumber, 'Max reconnect attempts reached. Giving up.');
                resolve(); // Resolve the promise when max reconnect attempts are reached
            }
        });
    }

    function reconnect() {
        logMessage(accountNumber, 'Attempting to reconnect...');
        connect(accessToken, accountNumber, resolve);
    }

    function sendHomeData() {
        ws.send(`42${eventTypeNumber}["homeData"]`);
        eventTypeNumber++;
    }

    function startGame() {
        if (!gameStarted) {
            logMessage(accountNumber, `Account #${accountNumber} | Sending startGame message...`);
            ws.send(`42${eventTypeNumber}["startGame"]`);
            eventTypeNumber++;
            gameStarted = true;
        } else {
            logMessage(accountNumber, `Account #${accountNumber} | Game already started, not sending startGame message.`);
        }
    }

    function sendInGameMessage(gameData) {
        if (isSendingMessage || !shouldSendInGameMessages) return;

        isSendingMessage = true;

        const timestamp = Date.now();
        const message = `42${eventTypeNumber}["inGame",{"round":${currentRound},"time":${timestamp},"gameover":false}]`;
        // logMessage(accountNumber, `Account #${accountNumber} | Sending in-game message: ${message}`);
        ws.send(message);
        eventTypeNumber++;

        if (!gameData.gameover && gameData.durability > 0) {
            setTimeout(() => {
                isSendingMessage = false;
                sendInGameMessage(gameData);
            }, 500);
        } else {
            isSendingMessage = false;
        }
    }

    ws = new WebSocket(uri, options(accessToken));
    attachWebSocketHandlers();
}