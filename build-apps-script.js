/**
 * Builds a self-contained Apps Script deployment from source modules and one
 * game definition. Generated output belongs in apps-script/dist-iq or dist-v5 and is not edited by hand.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const source = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const gameId = process.argv[2];
if (!gameId) throw new Error("Specify a game ID, for example 'level-up' or 'override'.");
if (!/^[a-z0-9-]+$/.test(gameId) || !fs.existsSync(path.join(__dirname, "games", gameId, "definition.js"))) throw new Error(`Unknown game target: ${gameId}`);
const target = require(`./games/${gameId}/definition.js`);
const outputName = target.program === "VEX IQ" ? "dist-iq" : target.program === "VEX V5" ? "dist-v5" : `dist-${gameId}`;
const output = path.join(__dirname, "apps-script", outputName);
fs.mkdirSync(output, { recursive: true });
const soundNames = ["countdown-3", "countdown-2", "countdown-1", "start", "switch-open", "switch-close", "end"];
const soundData = Object.fromEntries(soundNames.map(name => [name, fs.readFileSync(path.join(__dirname, `timer-${name}.wav`)).toString("base64")]));
fs.writeFileSync(path.join(__dirname, "timer-sounds.js"), `"use strict";\nglobalThis.TimerSoundData = ${JSON.stringify(soundData)};\n`);

const gameFiles = [`games/${gameId}/definition.js`, "game.js"];
const practiceView = `games/${gameId}/practice-ui.js`;
const clientGameFiles = [gameFiles[0], ...(fs.existsSync(path.join(__dirname, practiceView)) ? [practiceView] : []), gameFiles[1]];
const Game = { active: target };
const gameSource = source("game.js")
  .replace('const ACTIVE_GAME_ID = "level-up";', `const ACTIVE_GAME_ID = "${gameId}";`)
  .replace('const LEGACY_GAME_ID = "level-up";', `const LEGACY_GAME_ID = "${gameId}";`)
  .replace(/Object\.fromEntries\(\[[^\]]+\]\.map\(game => \[game\.id, game\]\)\)/, `Object.fromEntries([require("./games/${gameId}/definition.js")].map(game => [game.id, game]))`);
const sourceFor = name => name === "game.js" ? gameSource : source(name);
const image = name => `data:image/png;base64,${fs.readFileSync(path.join(__dirname, name)).toString("base64")}`;

let gameStylesheetIncluded = false;
let html = source("index.html")
  .replaceAll(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g, (_, name) => {
    if (name.startsWith("games/")) {
      if (gameStylesheetIncluded) return "";
      gameStylesheetIncluded = true;
      return `<style>${source(`games/${gameId}/styles.css`)}</style>`;
    }
    return `<style>${source(name)}</style>`;
  })
  .replaceAll("games/level-up/", `games/${gameId}/`)
  .replace(/^\s*<script src="[^"]+" defer><\/script>/gm, "")
  .replace('href="index.html"', 'href="#"')
  .replace(/<img data-game-field[^>]*>/, match => Game.active.fieldImage ? match.replace(/src="[^"]+"/, `src="${image(Game.active.fieldImage)}"`) : "")
  .replaceAll(/(href|src)="nu_robotics_logo_dark\.png"/g, (_, attribute) => `${attribute}="data:image/png;base64,${fs.readFileSync(path.join(__dirname, "nu_robotics_logo_dark.png")).toString("base64")}"`)
  .replace("LOCAL MATCH MANAGER", "SHARED MATCH MANAGER");
const rulesFiles = ["scoring.js", "scheduling.js", "teams.js", "event-rules.js"];
const scripts = [...clientGameFiles, ...rulesFiles, "finals.js", "history.js", "rubric.js", "event.js", "changes.js", "storage.js", "timer-sounds.js", "timer-audio.js", "app.js", "skills.js", "practice.js", "rubric-guidance.js", "rubric-ui.js", "access-ui.js"].map(name => `<script>\n${sourceFor(name).replace(/<\/script/gi, "<\\/script")}\n</script>`).join("\n");
html = html.replace("</body>", () => `${scripts}\n</body>`);
fs.writeFileSync(path.join(output, "Index.html"), html);
fs.writeFileSync(path.join(output, "Models.gs"), [...gameFiles, ...rulesFiles, "finals.js", "history.js", "rubric.js", "event.js", "changes.js"].map(sourceFor).join("\n"));
for (const name of ["Code.gs", "appsscript.json"]) fs.copyFileSync(path.join(__dirname, "apps-script", name), path.join(output, name));
console.log(`Apps Script deployment files generated in ${output}`);
