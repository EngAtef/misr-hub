"use client";

import { useRef, useState } from "react";
import { Bold, Italic, Underline, List, Smile, SendHorizonal, Paperclip } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { sanitizeHtml, EMOJI } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

export interface MentionUser {
  id: string;
  name: string;
}

/**
 * Small rich-text composer (bold/italic/underline/bullets + emoji) shared by
 * the inbox chat and the notification sender. Calls onSend with sanitized HTML.
 * Optional: @mention autocomplete over `mentionUsers`, file attach button via
 * `onAttach`.
 */
export function RichComposer({
  onSend,
  placeholder,
  sendOnEnter = true,
  disabled = false,
  mentionUsers,
  onAttach,
}: {
  onSend: (html: string) => void | Promise<void>;
  placeholder?: string;
  sendOnEnter?: boolean;
  disabled?: boolean;
  mentionUsers?: MentionUser[];
  onAttach?: (file: File) => void | Promise<void>;
}) {
  const { t } = useLang();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

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

  // text before the caret in the current text node, to detect a trailing "@query"
  function caretMention(): { node: Node; offset: number; query: string } | null {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return null;
    if (!editorRef.current?.contains(sel.anchorNode)) return null;
    const upto = (sel.anchorNode.textContent || "").slice(0, sel.anchorOffset);
    const m = /(?:^|\s)@([^\s@]*)$/.exec(upto);
    if (!m) return null;
    return { node: sel.anchorNode, offset: sel.anchorOffset, query: m[1] };
  }

  function refreshMentionState() {
    if (!mentionUsers?.length) return;
    setMentionQuery(caretMention()?.query ?? null);
  }

  function insertMention(name: string) {
    const hit = caretMention();
    const sel = window.getSelection();
    if (hit && sel) {
      const range = document.createRange();
      range.setStart(hit.node, hit.offset - hit.query.length - 1); // include the "@"
      range.setEnd(hit.node, hit.offset);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    editorRef.current?.focus();
    document.execCommand("insertText", false, `@${name} `);
    setMentionQuery(null);
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
    setMentionQuery(null);
    onSend(html);
  }

  const tools = [
    { icon: Bold, label: t("boldLbl"), cmd: "bold" },
    { icon: Italic, label: t("italicLbl"), cmd: "italic" },
    { icon: Underline, label: t("underlineLbl"), cmd: "underline" },
    { icon: List, label: t("bulletsLbl"), cmd: "insertUnorderedList" },
  ];

  const mentionMatches =
    mentionQuery === null
      ? []
      : (mentionUsers ?? [])
          .filter((u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6);

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
        {onAttach && (
          <>
            <button
              type="button"
              title={t("attachFile")}
              aria-label={t("attachFile")}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,.pdf,.csv,.txt,.xlsx,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onAttach(f);
              }}
            />
          </>
        )}
      </div>
      <div className="relative flex items-end gap-2 p-2">
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full start-2 z-30 mb-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            {mentionMatches.map((u) => (
              <button
                key={u.id}
                type="button"
                className="block w-full px-3 py-2 text-start text-sm hover:bg-brand-50"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u.name);
                }}
              >
                @{u.name}
              </button>
            ))}
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          dir="auto"
          className="min-h-[2.5rem] max-h-40 flex-1 overflow-y-auto rounded-lg px-2 py-1.5 text-sm outline-none [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5"
          onInput={(e) => {
            setEmpty(!(e.currentTarget.textContent?.trim()));
            refreshMentionState();
          }}
          onKeyUp={refreshMentionState}
          onClick={refreshMentionState}
          onKeyDown={(e) => {
            if (sendOnEnter && e.key === "Enter" && !e.shiftKey && mentionMatches.length === 0) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Enter" && mentionMatches.length > 0) {
              e.preventDefault();
              insertMention(mentionMatches[0].name);
            }
            if (e.key === "Escape") setMentionQuery(null);
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
