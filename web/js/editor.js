import { esc, jsonHighlight, sqlHighlight } from './ui.js';

/**
 * A dependency-free code editor with a syntax-highlighted layer, line numbers,
 * tab support and a Ctrl/Cmd+Enter run shortcut.
 */
export class CodeEditor {
  constructor(container, {
    language = 'sql',
    value = '',
    minHeight = 300,
    placeholder = '',
    onRun = null,
    onChange = null,
  } = {}) {
    this.container = container;
    this.language = language;
    this.onRun = onRun;
    this.onChange = onChange;
    this.minHeight = minHeight;
    container.innerHTML = `
      <div class="code-gutter" aria-hidden="true"></div>
      <div class="code-scroll">
        <pre class="code-highlight" aria-hidden="true"><code></code></pre>
        <textarea class="code-input" spellcheck="false" autocomplete="off" autocapitalize="off"
          autocorrect="off" wrap="off" placeholder="${esc(placeholder)}"></textarea>
      </div>
    `;
    container.classList.add('code-editor');
    container.style.setProperty('--editor-min-height', `${minHeight}px`);
    this.gutter = container.querySelector('.code-gutter');
    this.scroll = container.querySelector('.code-scroll');
    this.pre = container.querySelector('.code-highlight');
    this.code = this.pre.querySelector('code');
    this.textarea = container.querySelector('.code-input');
    this.textarea.value = value;
    this.bind();
    this.refresh();
  }

  bind() {
    this.textarea.addEventListener('input', () => {
      this.refresh();
      this.onChange?.(this.getValue());
    });
    this.textarea.addEventListener('scroll', () => this.syncScroll());
    this.textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.onRun?.();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const { selectionStart, selectionEnd } = this.textarea;
        const value = this.textarea.value;
        this.textarea.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
        this.textarea.selectionStart = this.textarea.selectionEnd = selectionStart + 2;
        this.refresh();
        this.onChange?.(this.getValue());
      }
    });
  }

  highlight() {
    const value = this.textarea.value;
    return this.language === 'json' ? jsonHighlight(value) : sqlHighlight(value);
  }

  refresh() {
    const value = this.textarea.value;
    this.code.innerHTML = this.highlight() || ' ';
    const count = Math.max(1, value.split('\n').length);
    const current = Number(this.gutter.dataset.count || 0);
    if (current !== count) {
      this.gutter.dataset.count = String(count);
      this.gutter.innerHTML = Array.from({ length: count }, (_, index) => `<span>${index + 1}</span>`).join('');
    }
    this.syncScroll();
  }

  syncScroll() {
    this.pre.scrollTop = this.textarea.scrollTop;
    this.pre.scrollLeft = this.textarea.scrollLeft;
    this.gutter.scrollTop = this.textarea.scrollTop;
  }

  getValue() {
    return this.textarea.value;
  }

  setValue(value, { focus = false } = {}) {
    this.textarea.value = value ?? '';
    this.refresh();
    if (focus) this.focus();
  }

  insert(text) {
    const { selectionStart, selectionEnd } = this.textarea;
    const value = this.textarea.value;
    this.textarea.value = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`;
    this.textarea.selectionStart = this.textarea.selectionEnd = selectionStart + text.length;
    this.refresh();
    this.focus();
  }

  focus() {
    this.textarea.focus();
  }

  setReadOnly(readOnly) {
    this.textarea.readOnly = readOnly;
    this.container.classList.toggle('is-readonly', readOnly);
  }
}
