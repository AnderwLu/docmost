import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Group, Text, Paper, ActionIcon, Loader, Tooltip } from "@mantine/core";
import { getFileUrl } from "@/lib/config.ts";
import {
  IconDownload,
  IconExternalLink,
  IconFileTypePdf,
  IconPaperclip,
} from "@tabler/icons-react";
import { useHover } from "@mantine/hooks";
import { formatBytes } from "@/lib";
import { useTranslation } from "react-i18next";
import { useCallback } from "react";
// OEM 挂载点：格式判断和在线编辑业务保持在独立集成模块中。
import { isOnlyOfficeFile } from "@/integrations/onlyoffice/onlyoffice-service";

export default function AttachmentView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { editor, node, getPos, selected } = props;
  const { url, name, size, mime, attachmentId, placeholder } = node.attrs;
  const { hovered, ref } = useHover();

  const isPdf = mime === "application/pdf" || name?.toLowerCase().endsWith(".pdf");
  // OEM 挂载点：只给首期支持的 OOXML 附件显示入口，旧格式继续沿用下载行为。
  const canOpenInOnlyOffice = !!attachmentId && isOnlyOfficeFile(name);

  const handleEmbedAsPdf = useCallback(() => {
    const pos = getPos();
    if (pos === undefined || !url) return;

    const nodeSize = node.nodeSize;

    editor
      .chain()
      .insertContentAt(
        { from: pos, to: pos + nodeSize },
        {
          type: "pdf",
          attrs: {
            src: url,
            name,
            attachmentId,
            size,
          },
        },
      )
      .run();
  }, [editor, getPos, node, url, name, attachmentId]);

  const handleOpenInOnlyOffice = useCallback(() => {
    if (!attachmentId) return;
    window.open(
      `/office/edit/${encodeURIComponent(attachmentId)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [attachmentId]);

  return (
    <NodeViewWrapper>
      <Paper withBorder p="4px" ref={ref} data-drag-handle>
        <Group
          justify="space-between"
          gap="xl"
          style={{ cursor: "pointer" }}
          wrap="nowrap"
          h={25}
        >
          <Group wrap="nowrap" gap="sm" style={{ minWidth: 0, flex: 1 }}>
            {!url && placeholder ? (
              <Loader size={20} style={{ flexShrink: 0 }} />
            ) : (
              <IconPaperclip size={20} style={{ flexShrink: 0 }} />
            )}

            <Text component="span" size="md" truncate="end" style={{ minWidth: 0 }}>
              {!url && placeholder ? t("Uploading {{name}}", { name }) : name}
            </Text>

            <Text component="span" size="sm" c="dimmed" style={{ flexShrink: 0 }}>
              {formatBytes(size)}
            </Text>
          </Group>

          {url && (selected || hovered) && (
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              {/* OEM 挂载点：新标签页打开，不改变官方附件下载入口。 */}
              {canOpenInOnlyOffice && (
                <Tooltip
                  label={t("Open online")}
                  position="top"
                  withinPortal={false}
                >
                  <ActionIcon
                    variant="default"
                    aria-label={t("Open online")}
                    onClick={handleOpenInOnlyOffice}
                  >
                    <IconExternalLink size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              {isPdf && editor.isEditable && (
                <Tooltip
                  label={t("Embed as PDF")}
                  position="top"
                  withinPortal={false}
                >
                  <ActionIcon
                    variant="default"
                    aria-label={t("Embed as PDF")}
                    onClick={handleEmbedAsPdf}
                  >
                    <IconFileTypePdf size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <a href={getFileUrl(url)} target="_blank">
                <ActionIcon variant="default" aria-label="download file">
                  <IconDownload size={18} />
                </ActionIcon>
              </a>
            </Group>
          )}
        </Group>
      </Paper>
    </NodeViewWrapper>
  );
}
