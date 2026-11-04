import {
  Group,
  List,
  Text,
  TextInput,
  ActionIcon,
  Tooltip,
  Stack,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getAppUrl } from "@/lib/config.ts";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { CopyButton } from "@/components/common/copy-button.tsx";

export default function McpSettings() {
  const { t } = useTranslation();
  const mcpUrl = `${getAppUrl()}/mcp`;

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="nowrap" gap="xl">
        <div>
          <Text size="md">{t("Model Context Protocol (MCP)")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Enable the MCP server to allow AI assistants and tools to interact with your workspace content.",
            )}{" "}
            {t(
              "This OEM build provides permission-aware read and write tools.",
            )}
          </Text>
        </div>
      </Group>

      <div>
        <Text size="sm" fw={500} mb={4}>
          {t("MCP Server URL")}
        </Text>
        <Group gap="xs">
          <TextInput value={mcpUrl} readOnly style={{ flex: 1 }} />
          <CopyButton value={mcpUrl} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip
                label={copied ? t("Copied") : t("Copy")}
                withArrow
                position="right"
              >
                <ActionIcon
                  color={copied ? "teal" : "gray"}
                  variant="subtle"
                  onClick={copy}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
        <Text size="sm" c="dimmed" mt="xs">
          {t(
            "Connect using OAuth and sign in with your existing Docmost account. Manage authorized connections in your account settings.",
          )}
        </Text>

        <div>
          <Text size="sm" fw={500} mt="md" mb={4}>
            {t("Supported tools")}
          </Text>
          <List size="sm" spacing={2}>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                search_pages, get_page, list_pages, list_child_pages
              </Text>
            </List.Item>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                get_space, list_spaces
              </Text>
            </List.Item>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                search_attachments, get_attachment, download_attachment,
                get_current_user
              </Text>
            </List.Item>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                create_page, update_page, move_page, create_comment
              </Text>
            </List.Item>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                create_space, update_space, delete_space, list_page_attachments
              </Text>
            </List.Item>
            <List.Item>
              <Text size="sm" c="dimmed" span>
                upload_attachment, delete_attachment, replace_attachment,
                create_page_with_attachments
              </Text>
            </List.Item>
          </List>
        </div>
      </div>
    </Stack>
  );
}
