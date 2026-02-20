import { forwardRef } from "react";
import { Progress } from "@/components/ui/progress";

interface TransferDownloadItem {
  fileName: string;
  statusLabel: string;
  detailMessage?: string;
  progressPercent: number;
  canCancel: boolean;
  onCancel: () => void | Promise<void>;
}

interface TransferUploadItem {
  id: string;
  fileName: string;
  statusLabel: string;
  message?: string;
  progress: number;
  isInProgress: boolean;
  trailingLabel: string;
}

interface TransferListPopoverProps {
  downloadItem?: TransferDownloadItem | null;
  uploadSummaryLabel: string;
  uploadItems: TransferUploadItem[];
  canCancelUploads: boolean;
  onCancelUploads: () => void | Promise<void>;
}

const transferItemClassName = "rounded-xl border border-border/55 bg-secondary/20 px-3 py-2 backdrop-blur-md backdrop-saturate-150";

export const TransferListPopover = forwardRef<HTMLDivElement, TransferListPopoverProps>(
  function TransferListPopover({
    downloadItem,
    uploadSummaryLabel,
    uploadItems,
    canCancelUploads,
    onCancelUploads,
  }, ref) {
    const hasDownloadItem = !!downloadItem;
    const hasUploadItems = uploadItems.length > 0;

    return (
      <div
        ref={ref}
        className="absolute right-0 top-[calc(100%+8px)] z-[95] w-[360px] rounded-xl border border-border/60 bg-glass p-2 shadow-2xl shadow-black/50 backdrop-blur-xl backdrop-saturate-150"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {hasDownloadItem && downloadItem && (
          <div className={transferItemClassName}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-body font-medium text-foreground">Download</p>
                <p className="text-small truncate text-muted-foreground" title={downloadItem.fileName}>
                  {downloadItem.fileName}
                </p>
              </div>
              {downloadItem.canCancel && (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void downloadItem.onCancel();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className="cursor-pointer rounded-md px-2 py-1 text-small text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="text-small text-muted-foreground">{downloadItem.statusLabel}</p>
            {downloadItem.detailMessage && downloadItem.detailMessage !== downloadItem.statusLabel && (
              <p className="text-small text-muted-foreground/80">{downloadItem.detailMessage}</p>
            )}
            <Progress
              value={downloadItem.progressPercent}
              className="mt-2 h-1.5 bg-secondary/60"
            />
          </div>
        )}

        {hasDownloadItem && hasUploadItems && <div className="my-2 h-px bg-border/70" />}

        {hasUploadItems && (
          <div className="space-y-2">
            <div className="px-1">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-body font-medium text-foreground">Uploads</p>
                  <p className="text-small text-muted-foreground tabular-nums">{uploadSummaryLabel}</p>
                </div>
                {canCancelUploads && (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onCancelUploads();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    className="cursor-pointer rounded-md px-2 py-1 text-small text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
                  >
                    Cancel remaining
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {uploadItems.map((item) => (
                <div key={item.id} className={transferItemClassName}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body truncate font-medium text-foreground" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <p className="text-small text-muted-foreground">{item.statusLabel}</p>
                      {item.message && (
                        <p className="text-small truncate text-muted-foreground/80" title={item.message}>
                          {item.message}
                        </p>
                      )}
                    </div>
                    <span className="text-small text-muted-foreground tabular-nums">{item.trailingLabel}</span>
                  </div>
                  {item.isInProgress && (
                    <Progress value={item.progress} className="mt-2 h-1.5 bg-secondary/60" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

TransferListPopover.displayName = "TransferListPopover";
