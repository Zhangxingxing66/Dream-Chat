/**
 * 消息有限状态机
 *
 * 状态转换图：
 *
 *   idle ──SEND──► thinking ──TEXT_DELTA──► answering ──DONE──► completed
 *                     │                                              │
 *                     └──TOOL_DELTA──► tool_calling ──TOOL_DONE──► thinking (循环)
 *
 *   任意状态 ──ABORT──► aborted
 *   任意状态 ──ERROR──► failed
 *   completed/failed/aborted ──SEND──► thinking (新一轮)
 */

const TRANSITIONS = {
  idle:         { SEND: 'thinking' },
  thinking:     { TEXT_DELTA: 'answering', TOOL_DELTA: 'tool_calling', DONE: 'completed', ERROR: 'failed', ABORT: 'aborted' },
  answering:    { DONE: 'completed', ERROR: 'failed', ABORT: 'aborted' },
  tool_calling: { TOOL_DONE: 'thinking', ERROR: 'failed', ABORT: 'aborted' },
  completed:    { SEND: 'thinking' },
  failed:       { SEND: 'thinking' },
  aborted:      { SEND: 'thinking' },
};

export class MessageFSM {
  constructor(onTransition) {
    this.state = 'idle';
    this.onTransition = onTransition; // (prevState, nextState, event) => void
  }

  dispatch(event) {
    const next = TRANSITIONS[this.state]?.[event];
    if (!next) {
      console.warn(`[FSM] 非法转换: ${this.state} --${event}--> ?`);
      return false;
    }
    const prev = this.state;
    this.state = next;
    this.onTransition(prev, next, event);
    return true;
  }

  getState() {
    return this.state;
  }

  reset() {
    this.state = 'idle';
  }
}
