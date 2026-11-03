"use strict";
const fs = require("node:fs");
const path = require("node:path");
const source = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const output = path.join(__dirname, "apps-script", "dist");
fs.mkdirSync(output, { recursive: true });
const soundNames = ["countdown-3", "countdown-2", "countdown-1", "start", "switch-open", "switch-close", "end"];
const soundData = Object.fromEntries(soundNames.map(name => [name, fs.readFileSync(path.join(__dirname, `timer-${name}.wav`)).toString("base64")]));
fs.writeFileSync(path.join(__dirname, "timer-sounds.js"), `"use strict";\nglobalThis.TimerSoundData = ${JSON.stringify(soundData)};\n`);

const gameFiles = ["games/level-up/definition.js", "game.js"];
const Game = require("./game.js");
const image = name => `data:image/png;base64,${fs.readFileSync(path.join(__dirname, name)).toString("base64")}`;

let html = source("index.html")
  .replaceAll(/<link rel="stylesheet" href="([^"]+)">/g, (_, name) => `<style>${source(name)}</style>`)
  .replace(/^\s*<script src="[^"]+" defer><\/script>/gm, "")
  .replace('href="index.html"', 'href="#"')
  .replace(/(data-game-field src=")[^"]+"/, (_, prefix) => `${prefix}${image(Game.active.fieldImage)}"`)
  .replaceAll(/(href|src)="nu_robotics_logo_dark\.png"/g, (_, attribute) => `${attribute}="data:image/png;base64,${fs.readFileSync(path.join(__dirname, "nu_robotics_logo_dark.png")).toString("base64")}"`)
  .replace("LOCAL MATCH MANAGER", "SHARED MATCH MANAGER");
const scripts = [...gameFiles, "core.js", "finals.js", "history.js", "rubric.js", "event.js", "changes.js", "storage.js", "timer-sounds.js", "timer-audio.js", "app.js", "skills.js", "practice.js", "rubric-guidance.js", "rubric-ui.js", "access-ui.js"].map(name => `<script>\n${source(name).replace(/<\/script/gi, "<\\/script")}\n</script>`).join("\n");
html = html.replace("</body>", () => `${scripts}\n</body>`);
fs.writeFileSync(path.join(output, "Index.html"), html);
fs.writeFileSync(path.join(output, "Models.gs"), [...gameFiles, "core.js", "finals.js", "history.js", "rubric.js", "event.js", "changes.js"].map(source).join("\n"));
for (const name of ["Code.gs", "appsscript.json"]) fs.copyFileSync(path.join(__dirname, "apps-script", name), path.join(output, name));
console.log(`Apps Script deployment files generated in ${output}`);
