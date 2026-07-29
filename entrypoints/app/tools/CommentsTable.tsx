import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, MessageSquareReply, Upload } from 'lucide-react';
import type { EngineTypes } from '@/lib/engine/port';
import commentData, { type CommentFormat } from '@/lib/text/comment-data';
import ActiveTextEntry from '../ActiveTextEntry';
import FeatureBadge from '../FeatureBadge';
import type { ToolPanelProps } from './types';

type Comment = EngineTypes['AnnotationInfo'];

function download(name: string, format: CommentFormat, value: string): void {
  const type = format === 'xfdf' ? 'application/vnd.adobe.xfdf' : 'application/vnd.fdf';
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export default function CommentsTable({
  engine,
  onNavigate,
  onMutation,
  onError,
}: Pick<ToolPanelProps, 'engine' | 'onNavigate' | 'onMutation' | 'onError'>) {
  const [comments, setComments] = useState<readonly Comment[]>([]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'all' | EngineTypes['AnnotationState']>('all');
  const [sort, setSort] = useState<'page' | 'type' | 'author' | 'state'>('page');
  const [selected, setSelected] = useState<Comment | null>(null);
  const [textMode, setTextMode] = useState<'edit' | 'reply' | null>(null);
  const [format, setFormat] = useState<CommentFormat>('xfdf');
  const [exportPreview, setExportPreview] = useState<ReturnType<
    typeof commentData.exportComments
  > | null>(null);
  const [importPreview, setImportPreview] = useState<ReturnType<
    typeof commentData.importComments
  > | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void engine
      .listAnnotations()
      .then((items) => {
        setComments(items);
        setSelected((current) =>
          current ? (items.find((item) => item.id === current.id) ?? null) : null,
        );
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown comment error.';
        onError(`Loading comments failed. ${detail}`);
      });
  }, [engine, onError]);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return [...comments]
      .filter(
        (comment) =>
          (status === 'all' || comment.state === status) &&
          `${comment.type} ${comment.author} ${comment.contents} ${comment.subject}`
            .toLocaleLowerCase()
            .includes(needle),
      )
      .sort((left, right) => {
        if (sort === 'page') return left.pageIndex - right.pageIndex;
        return left[sort].localeCompare(right[sort]);
      });
  }, [comments, filter, sort, status]);

  const update = (comment: Comment, changes: EngineTypes['AnnotationUpdate']) => {
    void engine
      .updateAnnotation(comment.pageIndex, comment.id, changes)
      .then((result) => {
        onMutation(result);
        setTextMode(null);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown comment error.';
        onError(`Updating the comment failed. ${detail}`);
      });
  };

  const reply = (comment: Comment, contents: string) => {
    const page = engine.info.pages[comment.pageIndex];
    if (!page) return;
    const width = Math.min(180, page.width * 0.35);
    const height = Math.min(48, page.height * 0.1);
    const left = Math.min(page.bounds[2] - width, comment.rect[0] + 12);
    const top = Math.min(page.bounds[3] - height, comment.rect[3] + 12);
    void engine
      .addAnnotation({
        pageIndex: comment.pageIndex,
        type: 'Text',
        rect: [left, top, left + width, top + height],
        contents,
        author: comment.author,
        subject: `Reply: ${comment.subject || 'Comment'}`,
        replyTo: { pageIndex: comment.pageIndex, annotationId: comment.id },
        state: 'None',
        flags: 4,
      })
      .then((result) => {
        onMutation(result);
        setTextMode(null);
        load();
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown reply error.';
        onError(`Adding the reply failed. ${detail}`);
      });
  };

  const chooseImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file
      .text()
      .then((value) => commentData.importComments(format, value, engine.info.pages.length))
      .then(setImportPreview)
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown comment-data error.';
        onError(`Importing comments failed. ${detail}`);
      });
  };

  return (
    <section className="tool-panel" aria-label="Comments table">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Document review</span>
          <h2>Comments</h2>
        </div>
        <FeatureBadge status="LOCAL" />
      </div>
      <div className="table-controls comment-controls">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter comments"
          placeholder="Filter comments"
        />
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as 'all' | EngineTypes['AnnotationState'])
            }
          >
            <option value="all">All</option>
            <option value="None">Open</option>
            <option value="Accepted">Accepted</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Completed">Completed</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="page">Page</option>
            <option value="type">Type</option>
            <option value="author">Author</option>
            <option value="state">Status</option>
          </select>
        </label>
      </div>
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Type</th>
              <th scope="col">Comment</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((comment) => (
              <tr
                key={`${comment.pageIndex}-${comment.id}`}
                data-selected={selected?.id === comment.id}
                data-reply={comment.replyToId !== null}
              >
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(comment);
                      onNavigate(comment.pageIndex);
                    }}
                  >
                    {engine.info.pages[comment.pageIndex]?.label ?? comment.pageIndex + 1}
                  </button>
                </td>
                <td>{comment.type}</td>
                <td>
                  {comment.replyToId !== null ? (
                    <MessageSquareReply aria-hidden="true" size={14} />
                  ) : null}
                  {comment.contents || 'No comment text'}
                </td>
                <td>{comment.state === 'None' ? 'Open' : comment.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? (
        <p className="empty-message">No comments match this view.</p>
      ) : null}

      {selected ? (
        <div className="comment-inspector">
          <strong>{selected.subject || selected.type}</strong>
          <span>
            {selected.author || 'Unknown author'} · page {selected.pageIndex + 1}
          </span>
          <div className="panel-actions">
            <button type="button" onClick={() => setTextMode('edit')}>
              Edit body
            </button>
            <button type="button" onClick={() => setTextMode('reply')}>
              Reply
            </button>
            <select
              aria-label="Comment status"
              value={selected.state}
              onChange={(event) =>
                update(selected, {
                  state: event.target.value as EngineTypes['AnnotationState'],
                })
              }
            >
              <option value="None">Open</option>
              <option value="Accepted">Accepted</option>
              <option value="Rejected">Rejected</option>
              <option value="Cancelled">Cancelled</option>
              <option value="Completed">Completed</option>
            </select>
            <button
              type="button"
              onClick={() => {
                void engine
                  .deleteAnnotation(selected.pageIndex, selected.id)
                  .then((result) => {
                    onMutation(result);
                    setSelected(null);
                    load();
                  })
                  .catch((error: unknown) => {
                    const detail =
                      error instanceof Error ? error.message : 'Unknown comment error.';
                    onError(`Deleting comment failed. ${detail}`);
                  });
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
      {selected && textMode ? (
        <ActiveTextEntry
          kind="comment"
          label={textMode === 'reply' ? 'Reply body' : 'Comment body'}
          initialValue={textMode === 'edit' ? selected.contents : ''}
          onCommit={(value) =>
            textMode === 'edit' ? update(selected, { contents: value }) : reply(selected, value)
          }
          onCancel={() => setTextMode(null)}
        />
      ) : null}

      <fieldset className="workflow-group">
        <legend>Comment interchange</legend>
        <label>
          <span>Format</span>
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as CommentFormat)}
          >
            <option value="xfdf">XFDF</option>
            <option value="fdf">FDF</option>
          </select>
        </label>
        <div className="panel-actions">
          <button
            type="button"
            onClick={() => setExportPreview(commentData.exportComments(format, comments))}
          >
            <Download aria-hidden="true" size={15} /> Preview export
          </button>
          <button type="button" onClick={() => importInput.current?.click()}>
            <Upload aria-hidden="true" size={15} /> Preview import
          </button>
        </div>
        {/*
          `hidden` rather than the `sr-only` class. A file input is opened by the visible
          "Preview import" button calling .click() on this ref, so it never needs to be
          reachable on its own and gains nothing from being merely visually hidden.

          It also has to be OUT of layout, not just clipped. Under `sr-only` this input
          measured 1600px wide at x=1321 and stretched the document to 2921px against a
          1600px viewport, leaving ~1300px of blank page and a status bar spanning the
          overflow. A file input's "Choose File" control lives in shadow DOM and does not
          reliably honour the width and clip that `sr-only` applies to the host element.
        */}
        <input
          ref={importInput}
          hidden
          type="file"
          aria-label={`Import ${format.toLocaleUpperCase()} comments`}
          onChange={chooseImport}
        />
        <p className="scope-note">
          Comment text, author, subject, review state, reply links, page, and rectangle are
          preserved for Text and FreeText comments. Non-comment markup geometry is omitted and
          counted before export. Actions, scripts, and external references are rejected.
        </p>
      </fieldset>

      {exportPreview ? (
        <div className="result-preview" role="status">
          <strong>Export preview</strong>
          <p>
            Preserve {exportPreview.preserved} comments; omit {exportPreview.omitted}{' '}
            non-comment marks.
          </p>
          <div className="panel-actions">
            <button
              type="button"
              onClick={() => {
                download(
                  `${engine.info.name.replace(/\.pdf$/i, '')}-comments.${format}`,
                  format,
                  exportPreview.value,
                );
                setExportPreview(null);
              }}
            >
              Download {format.toLocaleUpperCase()}
            </button>
            <button type="button" onClick={() => setExportPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {importPreview ? (
        <div className="result-preview" role="status">
          <strong>Import preview</strong>
          <p>
            Add {importPreview.inputs.length} comments in one undoable action; omit{' '}
            {importPreview.omitted} unsupported marks.
          </p>
          <div className="panel-actions">
            <button
              type="button"
              onClick={() => {
                void engine
                  .addAnnotations(importPreview.inputs)
                  .then((result) => {
                    onMutation(result);
                    setImportPreview(null);
                    load();
                  })
                  .catch((error: unknown) => {
                    const detail =
                      error instanceof Error ? error.message : 'Unknown comment-data error.';
                    onError(`Importing comments failed. ${detail}`);
                  });
              }}
            >
              Import comments
            </button>
            <button type="button" onClick={() => setImportPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
