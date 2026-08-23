// node:testにはDOMが無いため、dialog.test.js / inlineEditor.test.jsが
// 使うAPIだけを持つ簡易DOM要素モック（storage.test.jsのlocalStorage
// モックと同じ方針）。実際の描画・見た目の確認はPlaywrightでの
// 実機確認に任せ、ここでは状態遷移のロジックだけを検証する。
// ファイル名を*.test.jsにしていないのは、node --test 'src/**/*.test.js'
// のグロブに引っかかってテストファイルとして実行されるのを避けるため
export function makeElement(tag) {
  const listeners = {};
  return {
    tagName: tag,
    className: '',
    textContent: '',
    value: '',
    style: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChild(newChild, oldChild) {
      const i = this.children.indexOf(oldChild);
      if (i !== -1) this.children[i] = newChild;
      return oldChild;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatch(type) {
      (listeners[type] || []).forEach((fn) => fn());
    },
    focus() {},
  };
}
