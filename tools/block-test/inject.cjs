// Sends a JS file (or -e expression) to the game V8 through the cdp-mcp console hub (127.0.0.1:9223)
// and prints the result. Usage: node inject.cjs file.js | node inject.cjs -e "expr" [--timeout 60000]
const net = require("net")
const fs = require("fs")

const args = process.argv.slice(2)
let code = ""
let timeout = 20000
for (let i = 0; i < args.length; i++) {
	if (args[i] === "-e") code += args[++i] + "\n"
	else if (args[i] === "--timeout") timeout = Number(args[++i])
	else code += fs.readFileSync(args[i], "utf8") + "\n"
}
const tag = "inject-" + process.pid + "-" + Date.now()
const socket = net.connect(9223, "127.0.0.1")
let buffer = ""
const timer = setTimeout(() => {
	console.error("timeout")
	process.exit(2)
}, timeout)
socket.on("connect", () => socket.write(JSON.stringify({ op: "eval", code, tag }) + "\n"))
socket.on("data", chunk => {
	buffer += chunk.toString("utf8")
	const lines = buffer.split("\n")
	buffer = lines.pop()
	for (const line of lines) {
		let msg
		try {
			msg = JSON.parse(line)
		} catch {
			continue
		}
		if (msg.ev === "result" && msg.tag === tag) {
			clearTimeout(timer)
			console.log(msg.text)
			socket.end()
			process.exit(msg.ok ? 0 : 1)
		}
	}
})
socket.on("error", e => {
	console.error("hub error:", e.message)
	process.exit(3)
})
