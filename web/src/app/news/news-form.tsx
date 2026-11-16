"use client";

import Link from "next/link";
import { useState } from "react";
import { RichTextBox } from "@/components/rich-text";
import { SaveButton } from "@/components/save-button";
import { deleteNewsPost, saveNewsPost } from "./actions";

type Post = { id: string; title: string; body: string; pinned: boolean } | null;

// Admins write or change a news post: a title, the text (with pictures), and an optional pin.
export function NewsForm({ post }: { post: Post }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="space-y-6">
      <form action={saveNewsPost} className="space-y-4" aria-label={post ? "Edit news post" : "New news post"}>
        {post && <input type="hidden" name="id" value={post.id} />}
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Title</span>
          <input
            name="title"
            required
            defaultValue={post?.title ?? ""}
            className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <div>
          <span className="text-sm font-medium text-slate-700">Text</span>
          <div className="mt-1">
            <RichTextBox name="body" label="News text" html={post?.body ?? ""} images minHeight="min-h-64" />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Use Add image to put a picture where the cursor is. Text pasted from Word or a website keeps its headings, lists and links, but
            fonts and colours are removed when you save.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="pinned" defaultChecked={post?.pinned ?? false} />
          <span>Pin to top (stays above newer posts until you untick it)</span>
        </label>
        <div className="flex items-center gap-4">
          <SaveButton>{post ? "Save post" : "Add post"}</SaveButton>
          <Link href="/" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
            Cancel
          </Link>
        </div>
      </form>

      {post && (
        <form action={deleteNewsPost} className="border-t border-slate-200 pt-4">
          <input type="hidden" name="id" value={post.id} />
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-800 underline underline-offset-2">
              Delete this post
            </button>
          ) : (
            <div className="space-y-3 rounded border border-red-300 bg-red-50 p-4" role="alertdialog" aria-label="Confirm delete">
              <p className="font-medium text-red-950">Delete this post? It will disappear from Club news for everyone.</p>
              <div className="flex items-center gap-4">
                <button type="submit" className="rounded bg-red-800 px-4 py-2 font-medium text-white hover:bg-red-950">
                  Yes, delete
                </button>
                <button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
