import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import api from "@/lib/api-client";

type Grant = {
  id: string;
  clientName: string;
  createdAt: number;
  expiresAt: number;
};
export default function McpConnections() {
  const [grants, setGrants] = useState<Grant[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  async function load() {
    try {
      const res = await api.post("/mcp-oauth/grants");
      setGrants(res.data);
    } catch {
      setError("无法加载授权连接，请稍后重试。");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function revoke(id: string) {
    setBusy(id);
    setError("");
    try {
      await api.post(`/mcp-oauth/grants/${encodeURIComponent(id)}/revoke`);
      await load();
    } catch {
      setError("撤销失败，请稍后重试。");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Stack>
      <Title order={3}>MCP 授权连接</Title>
      <Text size="sm" c="dimmed">
        客户端通过当前知识库账号登录授权。撤销后，该连接的访问令牌和刷新令牌立即失效。
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {!grants && !error && <Loader aria-label="正在加载授权连接" />}
      {grants?.length === 0 && <Text>暂无授权连接。</Text>}
      {grants?.map((grant) => (
        <Paper key={grant.id} withBorder p="md">
          <Group justify="space-between">
            <div>
              <Text fw={500}>{grant.clientName}</Text>
              <Text size="xs" c="dimmed">
                授权于 {new Date(grant.createdAt).toLocaleString()} · 到期于{" "}
                {new Date(grant.expiresAt).toLocaleString()}
              </Text>
            </div>
            <Button
              color="red"
              variant="light"
              loading={busy === grant.id}
              disabled={!!busy && busy !== grant.id}
              onClick={() => revoke(grant.id)}
            >
              撤销授权
            </Button>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
