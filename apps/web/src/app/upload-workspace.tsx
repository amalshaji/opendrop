import type { Dispatch, DragEvent, InputHTMLAttributes, RefObject, SetStateAction } from "react";
import type { ValidationResult, Visibility } from "@opendrop/shared/core";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FileArchive,
  FileText,
  FolderOpen,
  Globe2,
  ListChecks,
  Loader2,
  Route,
  ShieldCheck,
  UploadCloud,
  X
} from "lucide-react";
import { displayUploadPath, uploadPath } from "@/app/upload-files";
import { formatBytes, manifestRows } from "@/app/format";
import type { PublishResult } from "@/app/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface UploadWorkspaceProps {
  files: File[];
  uploadDragging: boolean;
  setUploadDragging: Dispatch<SetStateAction<boolean>>;
  uploadErrors: string[];
  folderInputRef: RefObject<HTMLInputElement | null>;
  zipInputRef: RefObject<HTMLInputElement | null>;
  acceptUploadFiles: (files: File[], source: "folder" | "zip" | "drop") => void;
  clearUploadFiles: () => void;
  handleUploadDrop: (event: DragEvent<HTMLDivElement>) => void | Promise<void>;
  routePreview: string;
  lastPublished: PublishResult | null;
  lastPublishedHref: string;
  lastPublishedDisplayUrl: string;
  copyLastPublishedUrl: () => void | Promise<void>;
  validation: ValidationResult | null;
  namespace: string;
  setNamespace: Dispatch<SetStateAction<string>>;
  slug: string;
  setSlug: Dispatch<SetStateAction<string>>;
  visibility: Visibility;
  setVisibility: Dispatch<SetStateAction<Visibility>>;
  publishUpload: () => void | Promise<void>;
  isPublishing: boolean;
}

const directoryInputProps = {
  webkitdirectory: "",
  directory: ""
} satisfies InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
  directory: string;
};

export function UploadWorkspace({
  files,
  uploadDragging,
  setUploadDragging,
  uploadErrors,
  folderInputRef,
  zipInputRef,
  acceptUploadFiles,
  clearUploadFiles,
  handleUploadDrop,
  routePreview,
  lastPublished,
  lastPublishedHref,
  lastPublishedDisplayUrl,
  copyLastPublishedUrl,
  validation,
  namespace,
  setNamespace,
  slug,
  setSlug,
  visibility,
  setVisibility,
  publishUpload,
  isPublishing
}: UploadWorkspaceProps) {
  const selectedFileTotal = files.reduce((total, file) => total + file.size, 0);
  const selectedFilePreview = files.slice(0, 6);

  return (
    <>
      <Card className="uploadPanel">
        <CardHeader className="uploadPanelHeader">
          <div className="uploadPanelTitle">
            <span>New deployment</span>
            <CardTitle>Upload source</CardTitle>
            <CardDescription>{files.length ? `${files.length} file(s) selected` : "Drop a folder or choose a zip. Validation runs before anything is published."}</CardDescription>
          </div>
          <div className="uploadSteps" aria-label="Publish progress">
            <span className={files.length ? "isComplete" : "isActive"}><UploadCloud size={14} /> Source</span>
            <span className={validation ? "isComplete" : files.length ? "isActive" : ""}><ListChecks size={14} /> Validate</span>
            <span className={validation?.ok ? "isActive" : ""}><Globe2 size={14} /> Publish</span>
          </div>
        </CardHeader>
        {lastPublished ? (
          <Alert className="publishSuccessBanner">
            <Globe2 size={16} />
            <AlertTitle>Your site is live</AlertTitle>
            <AlertDescription className="publishSuccessDetails">
              <a href={lastPublishedHref} target="_blank" rel="noreferrer">
                {lastPublishedDisplayUrl}
              </a>
              <Button type="button" variant="outline" size="sm" className="publishSuccessCopy" onClick={copyLastPublishedUrl}>
                <Copy size={14} /> Copy URL
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <CardContent className="uploadPanelContent">
          <div className="uploadComposer">
            <div
              className={`uploadDropzone${uploadDragging ? " isDragging" : ""}${files.length ? " hasFiles" : ""}`}
              data-dragging={uploadDragging ? "true" : undefined}
              onDragEnter={(event) => {
                event.preventDefault();
                setUploadDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setUploadDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setUploadDragging(false);
                }
              }}
              onDrop={handleUploadDrop}
            >
              <input
                ref={folderInputRef}
                className="uploadHiddenInput"
                type="file"
                multiple
                {...directoryInputProps}
                onChange={(event) => {
                  acceptUploadFiles(Array.from(event.currentTarget.files || []), "folder");
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={zipInputRef}
                className="uploadHiddenInput"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => {
                  acceptUploadFiles(Array.from(event.currentTarget.files || []), "zip");
                  event.currentTarget.value = "";
                }}
              />
              <div className="dropzoneHeader">
                <div className="dropzoneIcon">
                  <UploadCloud size={28} />
                </div>
                <div className="dropzoneCopy">
                  <strong>{uploadDragging ? "Drop to stage this deployment" : "Drop your static build here"}</strong>
                  <span>Drop a folder for build output, or choose a zip from CI. Server checks run next.</span>
                </div>
              </div>
              <div className="dropzoneActions">
                <Button type="button" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen size={16} /> Choose folder
                </Button>
                <Button type="button" variant="outline" onClick={() => zipInputRef.current?.click()}>
                  <FileArchive size={16} /> Choose zip
                </Button>
                {files.length ? (
                  <Button type="button" variant="ghost" onClick={clearUploadFiles}>
                    <X size={16} /> Clear
                  </Button>
                ) : null}
              </div>
              {uploadErrors.length ? (
                <div className="uploadErrorList" role="alert">
                  {uploadErrors.map((error) => (
                    <span key={error}>{error}</span>
                  ))}
                </div>
              ) : null}

              {files.length ? (
                <div className="uploadSelected" aria-label="Selected files">
                  <div className="uploadSelectedSummary">
                    <strong>{files.length} files selected</strong>
                    <span>{formatBytes(selectedFileTotal)}</span>
                  </div>
                  <div className="uploadFileList">
                    {selectedFilePreview.map((file) => (
                      <span key={`${uploadPath(file)}-${file.lastModified}`}>{displayUploadPath(file)}</span>
                    ))}
                    {files.length > selectedFilePreview.length ? <span>+{files.length - selectedFilePreview.length} more</span> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <aside className="uploadInspector" aria-label="Upload summary">
              <div className="inspectorBlock">
                <div className="inspectorLabel"><Route size={14} /> Deployment target</div>
                <strong className="monoValue">{routePreview}</strong>
              </div>
              <div className="inspectorBlock">
                <div className="inspectorLabel"><ShieldCheck size={14} /> Server checks</div>
                <ul className="constraintList">
                  <li><CheckCircle2 size={14} /> index.html at root <span>required</span></li>
                  <li><CheckCircle2 size={14} /> File count <span>20,000 max</span></li>
                  <li><CheckCircle2 size={14} /> Total size <span>90 MB max</span></li>
                  <li><CheckCircle2 size={14} /> Text lines <span>25k max</span></li>
                </ul>
              </div>
              <div className="inspectorBlock">
                <div className="inspectorLabel"><FileText size={14} /> Review mode</div>
                <p>Accepted files publish. Skipped files stay visible in validation.</p>
              </div>
            </aside>
          </div>

          <div className="publishDock">
            <label className="publishField">
              <span>Namespace</span>
              <Input value={namespace} onChange={(event) => setNamespace(event.target.value)} placeholder="namespace" />
            </label>
            <label className="publishField">
              <span>Slug</span>
              <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug optional" />
            </label>
            <div className="publishVisibility">
              <span>Visibility</span>
              <div className="visibilityToggle" aria-label="Preview visibility">
                <Button type="button" variant="outline" className={visibility === "public" ? "isSelected" : ""} onClick={() => setVisibility("public")}>
                  <Eye size={16} /> Public
                </Button>
                <Button type="button" variant="outline" className={visibility === "private" ? "isSelected" : ""} onClick={() => setVisibility("private")}>
                  <EyeOff size={16} /> Private
                </Button>
              </div>
            </div>
            <div className="publishActions">
              <Button type="button" onClick={publishUpload} disabled={!validation?.ok || isPublishing} aria-busy={isPublishing}>
                {isPublishing ? <Loader2 className="animate-spin" size={16} /> : null}
                {isPublishing ? "Publishing" : "Publish"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {validation ? (
        <Card className="review">
          <CardHeader>
            <div>
              <CardTitle>Validation</CardTitle>
              <CardDescription>
                {validation.acceptedFiles.length} accepted, {validation.skippedFiles.length} skipped, {formatBytes(validation.totalAcceptedBytes)} ready.
              </CardDescription>
            </div>
            <CardAction>
              <Badge className={validation.ok ? "badgeSuccess" : "badgeWarning"} variant="outline">{validation.ok ? "Ready" : "Needs review"}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="validationReview">
            <div className="validationMetrics" aria-label="Validation totals">
              <div>
                <span>Total files</span>
                <strong>{validation.acceptedFiles.length + validation.skippedFiles.length}</strong>
              </div>
              <div>
                <span>Total size</span>
                <strong>{formatBytes(validation.totalAcceptedBytes)}</strong>
              </div>
              <div>
                <span>Accepted files</span>
                <strong>{validation.acceptedFiles.length}</strong>
              </div>
              <div>
                <span>Skipped files</span>
                <strong>{validation.skippedFiles.length}</strong>
              </div>
              <div>
                <span>Total lines</span>
                <strong>{validation.totalLineCount}</strong>
              </div>
              <div>
                <span>Warnings</span>
                <strong>{validation.issues.filter((issue) => issue.severity === "warning").length}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{validation.issues.filter((issue) => issue.severity === "error").length}</strong>
              </div>
            </div>

            <div className="constraintBar" aria-label="Upload constraints">
              <Badge variant="secondary">index.html required</Badge>
              <Badge variant="secondary">25 MB per file</Badge>
              <Badge variant="secondary">90 MB total</Badge>
              <Badge variant="secondary">20,000 files</Badge>
              <Badge variant="secondary">25,000 lines per text file</Badge>
            </div>

            <div className="validationWorkspace">
              <div className="issues">
                <strong>Issues</strong>
                {validation.issues.map((issue, index) => (
                  <div key={`${issue.code}-${index}`} className={`issue ${issue.severity}`}>
                    <Badge
                      className={issue.severity === "error" ? "badgeDanger" : issue.severity === "warning" ? "badgeWarning" : ""}
                      variant={issue.severity === "error" ? "destructive" : "outline"}
                    >
                      {issue.severity}
                    </Badge>
                    <span>{issue.path ? `${issue.path}: ` : ""}{issue.message}</span>
                  </div>
                ))}
                {validation.ok ? (
                  <div className="issue ok">
                    <CheckCircle2 size={16} />
                    <span>Root index.html found.</span>
                  </div>
                ) : null}
              </div>

              <div className="manifestReview">
                <div className="manifestReviewHeader">
                  <strong>File tree</strong>
                  <span>{validation.acceptedFiles.length + validation.skippedFiles.length} files reviewed</span>
                </div>
                <div className="manifestRows">
                  {manifestRows(validation).map((file) => (
                    <div key={`${file.status}-${file.path}`} className={`manifestRow ${file.status}`}>
                      <span className="manifestPath" style={{ paddingLeft: `${file.depth * 14}px` }}>
                        {file.path}
                      </span>
                      <span>{file.lineCount === undefined ? "-" : `${file.lineCount} lines`}</span>
                      <span>{formatBytes(file.size)}</span>
                      <Badge variant={file.status === "accepted" ? "secondary" : "outline"}>{file.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
