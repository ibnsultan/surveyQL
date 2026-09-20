/**
 * The playground's code editor: a plain <textarea> with a syntax-highlighted <pre>
 * rendered behind it, a diagnostics list underneath, and Tab inserting two spaces.
 * Playground only; the language itself lives in src/.
 */
import { highlight } from "./highlight";
import { lint, type Diagnostic, type LintOptions } from "./lint";

export interface CodeEditor {
  readonly textarea: HTMLTextAreaElement;
  get value(): string;
  set value(v: string);
  /** Re-run the linter, e.g. after the dataset changed. */
  relint(): void;
  /** Update what the linter knows about (commands, dataset, source variables). */
  setLintOptions(opts: LintOptions): void;
}

export function mountEditor(textarea: HTMLTextAreaElement): CodeEditor {
  const wrap = document.createElement("div");
  wrap.className = "code-editor";
  const pre = document.createElement("pre");
  pre.className = "code-highlight";
  pre.setAttribute("aria-hidden", "true");
  const code = document.createElement("code");
  pre.appendChild(code);
  const problems = document.createElement("ul");
  problems.className = "diagnostics";

  textarea.parentNode!.insertBefore(wrap, textarea);
  wrap.append(pre, textarea);
  wrap.after(problems);
  textarea.wrap = "off";
  textarea.classList.add("code-input");

  let lintOptions: LintOptions = {};
  let diagnostics: Diagnostic[] = [];
  let lintTimer: number | undefined;

  function paint(): void {
    const errorLines = new Set(diagnostics.map((d) => d.line));
    code.innerHTML = highlight(textarea.value, errorLines, lintOptions.variables ?? []) + "\n";
    syncScroll();
  }

  function syncScroll(): void {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }

  function runLint(): void {
    try {
      diagnostics = lint(textarea.value, lintOptions);
    } catch (e) {
      diagnostics = [{ line: 1, message: `linter failed: ${(e as Error).message}`, severity: "warning" }];
    }
    renderProblems();
    paint();
  }

  function scheduleLint(): void {
    window.clearTimeout(lintTimer);
    lintTimer = window.setTimeout(runLint, 250);
  }

  function renderProblems(): void {
    problems.innerHTML = "";
    problems.hidden = diagnostics.length === 0;
    for (const d of diagnostics) {
      const li = document.createElement("li");
      li.className = d.severity;
      li.textContent = `line ${d.line}${d.col ? `:${d.col}` : ""}: ${d.message}`;
      li.title = "Go to line";
      li.addEventListener("click", () => goTo(d.line, d.col));
      problems.appendChild(li);
    }
  }

  function goTo(line: number, col = 1): void {
    const lines = textarea.value.split("\n");
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    pos += Math.max(0, col - 1);
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
    // keep the caret's line in view
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const top = (line - 1) * lineHeight;
    if (top < textarea.scrollTop || top > textarea.scrollTop + textarea.clientHeight - lineHeight) {
      textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 2);
    }
  }

  textarea.addEventListener("input", () => {
    paint();
    scheduleLint();
  });
  textarea.addEventListener("scroll", syncScroll);
  textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const { selectionStart: s, selectionEnd: end, value } = textarea;
    textarea.value = value.slice(0, s) + "  " + value.slice(end);
    textarea.setSelectionRange(s + 2, s + 2);
    textarea.dispatchEvent(new Event("input"));
  });
  new ResizeObserver(syncScroll).observe(textarea);

  return {
    textarea,
    get value() {
      return textarea.value;
    },
    set value(v: string) {
      textarea.value = v;
      paint();
      runLint();
    },
    relint: runLint,
    setLintOptions(opts: LintOptions) {
      lintOptions = opts;
      runLint();
    },
  };
}
