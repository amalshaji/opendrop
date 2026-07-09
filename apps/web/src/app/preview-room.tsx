import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from "react";
import {
  ArrowUp,
  CheckCheck,
  CheckCircle2,
  Copy,
  CornerDownRight,
  Eye,
  EyeOff,
  Highlighter,
  KeyRound,
  MessageSquarePlus,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  X
} from "lucide-react";
import type { AnnotationShape, Visibility } from "@opendrop/shared/core";
import { currentPathWithSearch, signInUrl } from "@/app/navigation";
import { relativeTime, shapeLabel } from "@/app/format";
import type { AnnotationMode, AnnotationRecord, DeploymentVersion, PublishResult, Session } from "@/app/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";

interface PreviewRoomProps {
  session: Session;
  publish: PublishResult;
  versions: DeploymentVersion[];
  activeVersionId: string | null;
  previewSrc: string;
  frameRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  commentsOpen: boolean;
  setCommentsOpen: Dispatch<SetStateAction<boolean>>;
  annotationMode: AnnotationMode;
  chooseAnnotationMode: (mode: AnnotationMode) => void;
  setBridgeNonce: Dispatch<SetStateAction<number>>;
  isPublishedOwner: boolean;
  publishedVisibility: Visibility;
  selectVersion: (versionId: string) => void;
  restoreActiveVersion: () => void | Promise<void>;
  updatePublishedVisibility: (visibility: Visibility) => void | Promise<void>;
  copyVersionUrl: () => void | Promise<void>;
  draftShape: AnnotationShape | null;
  annotation: string;
  setAnnotation: Dispatch<SetStateAction<string>>;
  isSubmitShortcut: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => boolean;
  addAnnotation: () => void | Promise<void>;
  annotations: AnnotationRecord[];
  openAnnotationCount: number;
  visibleRootAnnotations: AnnotationRecord[];
  repliesByParent: Record<string, AnnotationRecord[]>;
  selectedAnnotationId: string | null;
  setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
  replyDrafts: Record<string, string>;
  setReplyDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  replyingTo: string | null;
  setReplyingTo: Dispatch<SetStateAction<string | null>>;
  showResolved: boolean;
  setShowResolved: Dispatch<SetStateAction<boolean>>;
  addReply: (parent: AnnotationRecord) => void | Promise<void>;
  handleReplyKeyDown: (event: KeyboardEvent<HTMLInputElement>, parent: AnnotationRecord) => void;
  setAnnotationResolved: (annotationId: string, resolved: boolean) => void | Promise<void>;
}

const tools: Array<{ mode: AnnotationMode; icon: typeof MousePointer2; label: string; shortcut: string }> = [
  { mode: "browse", icon: MousePointer2, label: "Browse", shortcut: "B" },
  { mode: "comment", icon: MessageSquarePlus, label: "Comment", shortcut: "C" },
  { mode: "highlight", icon: Highlighter, label: "Highlight", shortcut: "H" }
];

export function PreviewRoom({
  session,
  publish,
  versions,
  activeVersionId,
  previewSrc,
  frameRef,
  iframeRef,
  commentsOpen,
  setCommentsOpen,
  annotationMode,
  chooseAnnotationMode,
  setBridgeNonce,
  isPublishedOwner,
  publishedVisibility,
  selectVersion,
  restoreActiveVersion,
  updatePublishedVisibility,
  copyVersionUrl,
  draftShape,
  annotation,
  setAnnotation,
  isSubmitShortcut,
  addAnnotation,
  annotations,
  openAnnotationCount,
  visibleRootAnnotations,
  repliesByParent,
  selectedAnnotationId,
  setSelectedAnnotationId,
  replyDrafts,
  setReplyDrafts,
  replyingTo,
  setReplyingTo,
  showResolved,
  setShowResolved,
  addReply,
  handleReplyKeyDown,
  setAnnotationResolved
}: PreviewRoomProps) {
  function scrollPreviewToAnnotation(annotationId: string) {
    iframeRef.current?.contentWindow?.postMessage({ source: "opendrop-host", type: "scrollTo", id: annotationId }, "*");
  }

  function annotationAuthorLabel(item: AnnotationRecord) {
    if (session.user?.id && session.user.id === item.authorUserId) return "You";
    return item.author?.email || item.author?.name || "Reviewer";
  }

  function threadReplyCount(id: string): number {
    return (repliesByParent[id] || []).length;
  }

  function renderCommentNode(item: AnnotationRecord, depth: number) {
    const children = repliesByParent[item.id] || [];
    const authorLabel = annotationAuthorLabel(item);
    const replyOpen = replyingTo === item.id;
    return (
      <div key={item.id} className={`commentNode ${depth > 0 ? "isReply" : ""}`}>
        <div className="commentMain">
          <div className="commentMeta">
            <span className="commentAuthor">{authorLabel}</span>
            <span>{relativeTime(item.createdAt)}</span>
          </div>
          <p className="commentBody">{item.body}</p>
          {session.authenticated ? (
            <div className="commentActions">
              <Button type="button" variant="ghost" size="sm" className="linkButton" onClick={() => setReplyingTo(replyOpen ? null : item.id)}>
                <CornerDownRight size={13} /> {replyOpen ? "Cancel" : "Reply"}
              </Button>
            </div>
          ) : null}
          {replyOpen ? (
            <div className="replyComposer inlineComposer">
              <Input
                autoFocus
                value={replyDrafts[item.id] || ""}
                onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                onKeyDown={(event) => handleReplyKeyDown(event, item)}
                placeholder="Write a reply"
              />
              <Button size="icon-sm" onClick={() => addReply(item)} disabled={!(replyDrafts[item.id] || "").trim()} aria-label="Send reply">
                <ArrowUp size={14} />
              </Button>
            </div>
          ) : null}
        </div>
        {children.length ? <div className="commentChildren">{children.map((child) => renderCommentNode(child, depth + 1))}</div> : null}
      </div>
    );
  }

  function renderThreadCard(item: AnnotationRecord) {
    const expanded = selectedAnnotationId === item.id;
    const replyCount = threadReplyCount(item.id);
    const replies = repliesByParent[item.id] || [];
    const authorLabel = annotationAuthorLabel(item);
    const replyOpen = replyingTo === item.id;
    const shape = shapeLabel(item.shape);
    const shapeIcon = annotationShapeIcon(item.shape);

    return (
      <AccordionItem
        key={item.id}
        value={item.id}
        data-thread-id={item.id}
        className={`threadCard ${expanded ? "isExpanded" : ""} ${item.resolvedAt ? "isResolved" : ""}`}
      >
        <AccordionTrigger className="threadItem" onClick={() => scrollPreviewToAnnotation(item.id)}>
          <span className="threadItemBody">
            <span className="threadShapeIcon" aria-label={shape}>{shapeIcon}</span>
            <span className="threadItemText">
              <span className="threadAuthorLabel">{authorLabel}</span>
              <small className="threadItemMeta">
                {relativeTime(item.createdAt)}
                {replyCount ? ` · ${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : ""}
              </small>
            </span>
          </span>
        </AccordionTrigger>

        <AccordionContent className="threadCardExpanded commentThread">
          <div className="commentNode threadRootNode">
            <div className="threadDetailHeader">
              <div className="threadDetailKicker">
                <Badge variant={item.resolvedAt ? "secondary" : "outline"}>
                  {item.resolvedAt ? "Resolved" : <span className="threadShapeBadgeIcon" aria-label={shape}>{annotationShapeIcon(item.shape)}</span>}
                </Badge>
                <span>{replyCount ? `${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "No replies yet"}</span>
              </div>
              {session.authenticated ? (
                <Button variant="outline" size="sm" onClick={() => setAnnotationResolved(item.id, !item.resolvedAt)}>
                  <CheckCircle2 size={14} /> {item.resolvedAt ? "Reopen" : "Resolve"}
                </Button>
              ) : null}
            </div>

            <div className="commentMain threadRootMain">
              <div className="commentMeta">
                <span className="commentAuthor">{authorLabel}</span>
                <span>{relativeTime(item.createdAt)}</span>
              </div>
              <p className="commentBody threadRootBody">{item.body}</p>
              {session.authenticated ? (
                <div className="commentActions">
                  <Button type="button" variant="ghost" size="sm" className="linkButton" onClick={() => setReplyingTo(replyOpen ? null : item.id)}>
                    <CornerDownRight size={13} /> {replyOpen ? "Cancel" : "Reply"}
                  </Button>
                </div>
              ) : null}
              {replyOpen ? (
                <div className="replyComposer inlineComposer">
                  <Input
                    autoFocus
                    value={replyDrafts[item.id] || ""}
                    onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    onKeyDown={(event) => handleReplyKeyDown(event, item)}
                    placeholder="Write a reply"
                  />
                  <Button size="icon-sm" onClick={() => addReply(item)} disabled={!(replyDrafts[item.id] || "").trim()} aria-label="Send reply">
                    <ArrowUp size={14} />
                  </Button>
                </div>
              ) : null}
            </div>

            {replies.length ? (
              <div className="commentChildren">
                <span className="replyDivider">Replies</span>
                {replies.map((reply) => renderCommentNode(reply, 1))}
              </div>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <TooltipProvider>
      <div className={`previewRoom ${commentsOpen ? "commentsOpen" : ""}`}>
        <header className="roomBar">
          <div className="roomBarGroup">
            <Select value={activeVersionId || publish.version.id} onValueChange={selectVersion}>
              <SelectTrigger className="roomSelect" aria-label="Preview version">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    v{version.versionNumber}{version.id === publish.family.latestVersionId ? " · latest" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isPublishedOwner && activeVersionId && activeVersionId !== publish.family.latestVersionId ? (
              <Button variant="outline" onClick={restoreActiveVersion}>
                <CheckCircle2 size={15} /> Restore
              </Button>
            ) : null}
            {isPublishedOwner ? (
              <div className="roomVisibility" aria-label="Preview visibility">
                <Button variant="outline" className={publishedVisibility === "public" ? "isSelected" : ""} onClick={() => updatePublishedVisibility("public")}>
                  <Eye size={15} /> Public
                </Button>
                <Button variant="outline" className={publishedVisibility === "private" ? "isSelected" : ""} onClick={() => updatePublishedVisibility("private")}>
                  <EyeOff size={15} /> Private
                </Button>
              </div>
            ) : null}
            <Button variant="outline" onClick={copyVersionUrl}>
              <Copy size={15} /> Copy link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={`roomIconButton ${commentsOpen ? "isActive" : ""}`}
              onClick={() => setCommentsOpen((value) => !value)}
              aria-label={commentsOpen ? "Hide comments" : "Show comments"}
              aria-pressed={commentsOpen}
            >
              {commentsOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </Button>
          </div>
        </header>

        <div className="roomStage">
          <div className={`roomCanvas mode-${annotationMode}`} ref={frameRef}>
            <iframe
              ref={iframeRef}
              title="OpenDrop preview"
              src={previewSrc}
              sandbox="allow-scripts allow-forms allow-popups"
              onLoad={() => setBridgeNonce((value) => value + 1)}
            />
          </div>

          <div className="roomToolbar" role="toolbar" aria-label="Annotation tools">
            {tools.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.mode}
                  type="button"
                  variant="outline"
                  className={`roomTool ${annotationMode === item.mode ? "isActive" : ""}`}
                  onClick={() => chooseAnnotationMode(item.mode)}
                  aria-pressed={annotationMode === item.mode}
                  aria-keyshortcuts={item.shortcut}
                  title={`${item.label} (${item.shortcut})`}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </Button>
              );
            })}
          </div>

          <Drawer open={commentsOpen} onOpenChange={setCommentsOpen} direction="right" modal={false} dismissible={false}>
            <DrawerContent showOverlay={false} className="roomComments reviewDrawerContent" aria-describedby="review-comments-description">
              <DrawerHeader className="roomCommentsHead">
                <div>
                  <DrawerTitle>Comments</DrawerTitle>
                  <DrawerDescription id="review-comments-description">
                    {openAnnotationCount} open · {annotations.length} total
                  </DrawerDescription>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" className="roomIconButton" onClick={() => setCommentsOpen(false)} aria-label="Close comments">
                  <X size={15} />
                </Button>
              </DrawerHeader>

              <div className="roomCommentsBody">
                {session.authenticated ? (
                  <div className="roomComposer">
                    {draftShape?.type === "highlight" && draftShape.text ? (
                      <div className="composerAnchor composerQuote">
                        <Highlighter size={13} />
                        <span>“{draftShape.text}”</span>
                      </div>
                    ) : draftShape?.type === "pin" ? (
                      <div className="composerAnchor">
                        <MessageSquarePlus size={13} /> Commenting on a point
                      </div>
                    ) : null}
                    <div className="composerBox">
                      <Textarea
                        value={annotation}
                        onChange={(event) => setAnnotation(event.target.value)}
                        onKeyDown={(event) => {
                          if (isSubmitShortcut(event)) {
                            event.preventDefault();
                            addAnnotation();
                          }
                        }}
                        placeholder="Add a comment"
                      />
                      <Button size="icon-sm" className="composerSubmit" onClick={addAnnotation} disabled={!annotation.trim()} aria-label="Submit comment">
                        <ArrowUp size={14} />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="emptyState emptyStateCard">
                    <KeyRound size={18} />
                    <strong>Sign in to comment</strong>
                    <span>You can read every comment. Sign in to add your own.</span>
                    <Button type="button" variant="outline" onClick={() => { location.href = signInUrl(currentPathWithSearch()); }}>
                      <KeyRound size={15} /> Sign in to comment
                    </Button>
                  </div>
                )}

                <div className="roomThreadHead">
                  <strong>{openAnnotationCount} open</strong>
                  <Button variant="outline" onClick={() => setShowResolved((value) => !value)}>
                    <CheckCheck size={15} /> {showResolved ? "Hide resolved" : "Show resolved"}
                  </Button>
                </div>

                <div className="roomThreadsBody">
                  <Accordion
                    type="single"
                    collapsible
                    value={selectedAnnotationId ?? ""}
                    onValueChange={(value) => {
                      setReplyingTo(null);
                      setSelectedAnnotationId(value || null);
                    }}
                    className="roomThreads"
                  >
                    {visibleRootAnnotations.map((item) => renderThreadCard(item))}
                    {visibleRootAnnotations.length === 0 ? (
                      <div className="emptyState emptyStateCard">
                        <MessageSquarePlus size={18} />
                        <strong>No comments yet</strong>
                        <span>Pick a tool, mark the page, then write a note.</span>
                      </div>
                    ) : null}
                  </Accordion>
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>
    </TooltipProvider>
  );
}

function annotationShapeIcon(shape: AnnotationShape) {
  if (shape.type === "highlight") return <Highlighter size={14} aria-hidden="true" />;
  if (shape.type === "region" || shape.type === "freehand") return <MousePointer2 size={14} aria-hidden="true" />;
  return <MessageSquarePlus size={14} aria-hidden="true" />;
}
