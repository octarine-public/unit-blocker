import { DebugPlans } from "./Block"
import { GetLaneFrame } from "./Lane"
import { Tuning } from "./Planner"

Object.assign(globalThis, { __ubTuning: Tuning, __ubPlans: DebugPlans, __ubLaneFrame: GetLaneFrame })
