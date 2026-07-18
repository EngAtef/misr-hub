"use client";

import { useRef, useState } from "react";
import { Bold, Italic, Underline, List, Smile, SendHorizonal } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { sanitizeHtml, EMOJI } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * Small rich-text composer (bold/italic/underline/bullets + emoji) shared by
 * the inbox chat and the notification sender. Calls onSend with sanitized HTML.
 */
export function RichComposer({
  onSend,
  placeholder,
  sendOnEnter = true,
  disabled = false,
}: {
  onSend: (html: string) => void | Promise<void>;
  placeholder?: string;
  sendOnEnter?: boolean;
  disabled?: boolean;
}) {
  const { t } = useLang();
  const editorRef = useRef<HTMLDivElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [empty, setEmpty] = useState(true);

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command);
  }

  function insertEmoji(emoji: string) {
    editorRef.current?.focus();
    document.execCommand("insertText", false, emoji);
    setEmojiOpen(false);
    setEmpty(false);
  }

  function submit() {
    const el = editorRef.current;
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    const text = el.textContent?.trim() ?? "";
    if (!text) return;
    el.innerHTML = "";
    setEmpty(true);
    onSend(html);
  }

  const tools = [
    { icon: Bold, label: t("boldLbl"), cmd: "bold" },
    { icon: Italic, label: t("italicLbl"), cmd: "italic" },
    { icon: Underline, label: t("underlineLbl"), cmd: "underline" },
    { icon: List, label: t("bulletsLbl"), cmd: "insertUnorderedList" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-0.5 border-b border-slate-100 px-2 py-1">
        {tools.map(({ icon: Icon, label, cmd }) => (
          <button
            key={cmd}
            type="button"
            title={label}
            aria-label={label}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onMouseDown={(e) => {
              e.preventDefault();
              exec(cmd);
            }}
          >
            <Icon size={15} />
          </button>
        ))}
        <div className="relative">
          <button
            type="button"
            title={t("emojiPicker")}
            aria-label={t("emojiPicker")}
            className={cn(
              "rounded-md p-1.5 hover:bg-slate-100",
              emojiOpen ? "bg-slate-100 text-amber-500" : "text-slate-500 hover:text-slate-700"
            )}
            onClick={() => setEmojiOpen((o) => !o)}
          >
            <Smile size={15} />
          </button>
          {emojiOpen && (
            <div className="absolute bottom-9 start-0 z-30 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rounded-md p-1 text-lg hover:bg-slate-100"
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    insertEmoji(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="relative flex items-end gap-2 p-2">
        <div
          ref={editorRef}
          contentEditable={!disabled}
          dir="auto"
          className="min-h-[2.5rem] max-h-40 flex-1 overflow-y-auto rounded-lg px-2 py-1.5 text-sm outline-none [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5"
          onInput={(e) => setEmpty(!(e.currentTarget.textContent?.trim()))}
          onKeyDown={(e) => {
            if (sendOnEnter && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {empty && placeholder && (
          <span className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            {placeholder}
          </span>
        )}
        <button
          type="button"
          className="btn-primary !px-3 !py-2"
          disabled={disabled || empty}
          onClick={submit}
          aria-label={t("send")}
        >
          <SendHorizonal size={16} className="rtl:-scale-x-100" />
        </button>
      </div>
    </div>
  );
}
