const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const {createMimeMessage} = require('mimetext');
const _ = require('lodash');

const subjectsMapRaw = JSON.parse(process.env.router).map(v => {
    v.next = v.next ? v.next : 0;
    v.probabilities = v.probabilities ? v.probabilities : _.range(v.emails.length).map(() => 1);
    return v;
});

const subjectsMap = subjectsMapRaw.map(v => {
    return {...v, regex: new RegExp(v.regex, "gi")};
});

const labels = [];

const repliers = [...new Set(subjectsMap.reduce((p, c) => [...p, ...c.emails], []))];

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

authorize(JSON.parse(process.env.oauth), main);

function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

const getSubject = (payload) => payload.headers.filter(p => p.name === "Subject")[0].value;
const getSenderEmail = (payload) => {
    const val = payload.headers.filter(p => p.name === "From")[0].value;
    return val.substring(val.indexOf("<") + 1, val.indexOf(">")).trim();
};
const getSenderName = (payload) => {
    const val = payload.headers.filter(p => p.name === "From")[0].value;
    return val.substring(0, val.indexOf("<") - 1).trim();
};

const getBody = (payload) => {
    if (!payload.parts) {
        if (!payload.body.data) {
            if (payload.body.attachmentId) {
                return [{
                    mime: payload.mimeType,
                    attachmentId: payload.body.attachmentId,
                    filename: payload.filename,
                    cid: payload.headers.filter(p => p.name === "Content-ID")[0].value
                }];
            }
            return [];
        }
        return [{mime: payload.mimeType, data: Buffer.from(payload.body.data, 'base64').toString("utf8")}];
    } else {
        const arr = [];
        for (let part of payload.parts) {
            arr.push(...getBody(part))
        }
        return arr;
    }
};

async function listEmails(gmail) {
    return await new Promise(resolve => {
        gmail.users.messages.list({
            userId: 'me',
            q: "to:ap.winter2022@gmail.com in:inbox is:unread"
        }, async (err, res) => {
            if (err) return console.log('The API returned an error: ' + err);
            const subjects = [];
            if (res.data?.messages) {
                for (let i = 0; i < res.data.messages.length; i++) {
                    subjects.push(await new Promise(resolve2 => {
                            gmail.users.messages.get({
                                userId: 'me',
                                id: res.data.messages[i].id,
                            }, async (err1, res1) => {
                                if (err1) return console.log('The API returned an error: ' + err1);

                                await new Promise(resolve4 => {
                                    gmail.users.messages.modify({
                                        userId: 'me',
                                        id: res.data.messages[i].id,
                                        resource: {
                                            addLabelIds: [],
                                            removeLabelIds: ['UNREAD']
                                        }
                                    }, () => {
                                        resolve4();
                                    });
                                });


                                const body = getBody(res1.data.payload);
                                const attachments = body.filter(value => !!value.attachmentId);

                                for (let b of attachments) {
                                    b.data = await new Promise(resolve3 => {
                                        gmail.users.messages.attachments.get({
                                            userId: 'me',
                                            messageId: res.data.messages[i].id,
                                            id: b.attachmentId
                                        }, (err2, res2) => {
                                            if (err2) return console.log('The API returned an error: ' + err2);
                                            let data = res2.data.data;
                                            resolve3(data.split(" ").join("+")
                                                .split("_").join("/")
                                                .split("-").join("+"));
                                        });
                                    });
                                }

                                const addr = getSenderEmail(res1.data.payload);

                                if (repliers.includes(addr)) {
                                    // TA -> Student
                                    // Egress
                                    let subject = getSubject(res1.data.payload);
                                    const receiver = subject.substring(subject.lastIndexOf("-") + 1).trim()
                                    if (subject.includes("-"))
                                        subject = subject.substring(0, subject.indexOf("-")).trim();

                                    resolve2({
                                        egress: true,
                                        subject: subject,
                                        receiver: receiver,
                                        sender: {
                                            name: getSenderName(res1.data.payload),
                                            addr: addr,
                                        },
                                        id: res.data.messages[i].id,
                                        body: body.filter(value => value.mime === "text/plain" || value.mime === "text/html"),
                                        attachments: attachments,
                                    });
                                } else {
                                    // Student -> TA
                                    // Ingress
                                    resolve2({
                                        egress: false,
                                        subject: getSubject(res1.data.payload),
                                        sender: {
                                            name: getSenderName(res1.data.payload),
                                            addr: addr,
                                        },
                                        id: res.data.messages[i].id,
                                        body: body.filter(value => value.mime === "text/plain" || value.mime === "text/html"),
                                        attachments: attachments,
                                    });
                                }


                            });
                        }
                    ));
                }
            }
            resolve(subjects);
        });
    });
}

async function run(gmail) {
    const emails = (await listEmails(gmail)).filter(email => (email.egress && email.receiver !== "ap.winter2022@gmail.com") || (!email.egress && email.sender.addr !== "ap.winter2022@gmail.com"));
    for (const email of emails) {
        let routed = false;
        for (let i = 0; i < subjectsMap.length; i++) {
            const subjectMap = subjectsMap[i];
            subjectMap.regex.lastIndex = 0;
            if (!!subjectMap.regex.test(email.subject)) {
                const msg = createMimeMessage();

                while (Math.random() > subjectMap.probabilities[subjectMap.next])
                    subjectMap.next = (subjectMap.next + 1) % subjectMap.emails.length;

                const rec = subjectMap.emails[subjectMap.next];
                subjectMap.next = (subjectMap.next + 1) % subjectMap.emails.length;
                subjectsMapRaw[i].next = subjectMap.next;
                process.env.router = JSON.stringify(subjectsMapRaw);
                if (email.egress) {
                    msg.setSender({
                        name: "Advanced Programming Spring 01",
                        addr: "ap.winter2022@gmail.com",
                    });
                    msg.setRecipient(email.receiver);
                    msg.setSubject(email.subject);
                } else {
                    msg.setSender(email.sender);
                    msg.setRecipient(rec);
                    msg.setSubject(email.subject + " - " + email.sender.name + " - " + email.sender.addr);
                }
                for (let body of email.body) {
                    msg.setMessage(body.mime, body.data);
                }
                for (let att of email.attachments) {
                    msg.setAttachment(att.filename, att.mime, att.data, {
                        "Content-ID": att.cid
                    });
                }
                await new Promise(resolve => {
                    gmail.users.messages.send({
                        userId: "me",
                        requestBody: {
                            "raw": msg.asEncoded(),
                        }
                    }, (err, res) => {
                        if (err) return console.log('The API returned an error: ' + err);
                        if (email.egress) {
                            console.log(`Routed back from ${email.sender.addr} to ${email.receiver}.`);
                            gmail.users.messages.modify({
                                userId: 'me',
                                id: email.id,
                                resource: {
                                    addLabelIds: labels.filter(value => value.name === "Backwarded").map(value => value.id),
                                    removeLabelIds: []
                                }
                            }, () => {
                                resolve();
                            });
                        }
                        else {
                            console.log(`Routed from ${email.sender.addr} to ${rec}.`);
                            gmail.users.messages.modify({
                                userId: 'me',
                                id: email.id,
                                resource: {
                                    addLabelIds: labels.filter(value => value.name === "Forwarded").map(value => value.id),
                                    removeLabelIds: []
                                }
                            }, () => {
                                resolve();
                            });
                        }

                    });
                });
                routed = true;
                break;
            }
        }
        if (!routed && !email.sender.addr.includes("noreply")) {
            const msg = createMimeMessage();
            msg.setSender({
                name: "Advanced Programming Spring 01",
                addr: "ap.winter2022@gmail.com",
            });
            msg.setRecipient(email.sender.addr);
            msg.setSubject("ERROR: " + email.subject);
            msg.setMessage("text/plain", "متاسفانه ایمیل شما به تدریسیاران ارجاع داده نشد؛ لطفا قالب مجاز موضوع ایمیل را رعایت کنید. این ایمیل بصورت خودکار ارسال شده است.");

            await new Promise(resolve => {
                gmail.users.messages.send({
                    userId: "me",
                    requestBody: {
                        "raw": msg.asEncoded(),
                    }
                }, (err, res) => {
                    if (err) return console.log('The API returned an error: ' + err);
                    console.log(`Error sent to ${email.sender.addr}.`);
                    gmail.users.messages.modify({
                        userId: 'me',
                        id: email.id,
                        resource: {
                            addLabelIds: labels.filter(value => value.name === "Invalid").map(value => value.id),
                            removeLabelIds: []
                        }
                    }, () => {
                        resolve();
                    });
                });
            });
        }
    }

    setTimeout(async () => await run(gmail), 30 * 1000);
}


function main(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    gmail.users.labels.list({
        userId: "me",
    }, (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);
        labels.push(...res.data.labels.filter(data => data.name === "Invalid" ||
            data.name === "Backwarded" ||
            data.name === "Forwarded" ));
        run(gmail);
    });
}
