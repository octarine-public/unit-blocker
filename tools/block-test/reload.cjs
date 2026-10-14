// Reloads the scripts runtime, waits for unit-blocker to come back and re-injects the harness.
const { execFileSync } = require("child_process")
const path = require("path")
const inject = (...args) => execFileSync("node", [path.join(__dirname, "inject.cjs"), ...args]).toString().trim()
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
try {
	inject("-e", "MenuSDK.CurrentHost().reloadScripts(); 1")
} catch {}
sleep(4000)
for (let i = 0; i < 30; i++) {
	try {
		if (inject("-e", "typeof __ubTuning") === '"object"') break
	} catch {}
	sleep(1000)
}
sleep(1500)
console.log(inject(path.join(__dirname, "bt.js")).split("\n")[0])
console.log("tuning:", inject("-e", "JSON.stringify(__ubTuning)"))
sleep(3000)
inject("-e", "ConVars.Set('engine_no_focus_sleep', 0); 1")
