import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import api from "@/lib/api-client";

type RequestInfo = {
  clientName: string;
  redirect: string;
  user: { id: string; workspaceId: string; name: string; email: string };
  workspaceName: string;
};
export default function McpAuthorizationPage() {
  const { requestId } = useParams();
  const [info, setInfo] = useState<RequestInfo>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Prevent request handles from being sent as referrers to another site.
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    let active = true;
    api
      .get(`/mcp-oauth/requests/${encodeURIComponent(requestId || "")}`)
      .then((res) => {
        if (active) setInfo(res.data);
      })
      .catch(() => {
        if (active) setError("授权请求已失效，请返回客户端重新连接。");
      });
    return () => {
      active = false;
      meta.remove();
    };
  }, [requestId]);
  async function decide(approved: boolean) {
    if (!info) return;
    setBusy(true);
    try {
      const res = await api.post(
        `/mcp-oauth/requests/${encodeURIComponent(requestId || "")}`,
        { approved, userId: info.user.id, workspaceId: info.user.workspaceId },
      );
      window.location.replace(res.data.redirect);
    } catch {
      setError("授权未完成，请返回客户端重新连接。");
      setBusy(false);
    }
  }
  return (
    <Container size={480} py="xl">
      <Paper withBorder p="xl">
        <Stack>
          <Title order={2}>授权连接知识库</Title>
          {error ? (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          ) : !info ? (
            <Loader aria-label="正在加载授权请求" />
          ) : (
            <>
              <Text>
                <strong>{info.clientName}</strong> 请求访问你的 Docmost 知识库。
              </Text>
              <Text size="sm">
                当前账号：{info.user.name}（{info.user.email}）
              </Text>
              <Text size="sm">工作区：{info.workspaceName}</Text>
              <Text size="sm">
                允许客户端读取、创建、修改和删除你有权限访问的页面及附件。访问范围受知识库现有权限限制。
              </Text>
              <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                授权结果将返回：{info.redirect}
              </Text>
              <Text size="sm" c="dimmed">
                你可以在账户设置中随时撤销授权。
              </Text>
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  拒绝
                </Button>
                <Button loading={busy} onClick={() => decide(true)}>
                  允许访问
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
