// Keeps the recorder (rec.js) in the game: every 2 s checks it is there and injects it again once
// the runtime has reloaded the scripts (a new match, a file changed in the script folder).
// Usage: node rec-watch.cjs   (runs until stopped; prints every re-injection)
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const inject = code =>
	execFileSync("node", [path.join(__dirname, "inject.cjs"), "-e", code], { stdio: ["ignore", "pipe", "ignore"] })
		.toString()
		.trim()

for (;;) {
	try {
		// the planner's dev hook is up once the scripts have loaded; the recorder reads its plans
		if (inject("typeof __rec + ',' + typeof __ubPlans") === '"undefined,object"') {
			const code = fs.readFileSync(path.join(__dirname, "rec.js"), "utf8")
			console.log(new Date().toLocaleTimeString(), "injected:", inject(code))
		}
	} catch {
		// the game or the hub is not up
	}
	sleep(2000)
}
