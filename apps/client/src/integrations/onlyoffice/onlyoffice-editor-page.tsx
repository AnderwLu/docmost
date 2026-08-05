import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createOnlyOfficeSession,
  OnlyOfficeSession,
} from "./onlyoffice-service";

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        elementId: string,
        config: Record<string, unknown>,
      ) => {
        destroyEditor?: () => void;
      };
    };
  }
}

export default function OnlyOfficeEditorPage() {
  const { attachmentId } = useParams();
  const [session, setSession] = useState<OnlyOfficeSession | null>(null);
  const [error, setError] = useState("");
  const editorRef = useRef<{ destroyEditor?: () => void } | null>(null);

  useEffect(() => {
    if (!attachmentId) {
      setError("文件不存在或链接无效。");
      return;
    }
    createOnlyOfficeSession(attachmentId)
      .then(setSession)
      .catch((reason) =>
        setError(
          reason?.response?.data?.message || "无法创建 ONLYOFFICE 编辑会话。",
        ),
      );
  }, [attachmentId]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const scriptUrl = `${session.documentServerUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`;

    loadOnlyOfficeScript(scriptUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        editorRef.current = new window.DocsAPI.DocEditor("onlyoffice-editor", {
          ...session.config,
          width: "100%",
          height: "100%",
          events: {
            onError: (event: { data?: { errorDescription?: string } }) =>
              setError(
                event.data?.errorDescription || "ONLYOFFICE 编辑器加载失败。",
              ),
          },
        });
      })
      .catch(() => setError("无法连接 ONLYOFFICE Document Server。"));

    return () => {
      cancelled = true;
      editorRef.current?.destroyEditor?.();
      editorRef.current = null;
    };
  }, [session]);

  if (error) {
    return (
      <Center h="100vh" p="md">
        <Stack maw={520} w="100%">
          <Alert color="red" title="在线编辑不可用">
            {error}
          </Alert>
          {session?.downloadUrl && (
            <Button component="a" href={session.downloadUrl}>
              下载原附件
            </Button>
          )}
        </Stack>
      </Center>
    );
  }

  return (
    <Stack h="100vh" gap={0}>
      {!session && (
        <Center h="100vh">
          <Stack align="center">
            <Loader />
            <Text>正在打开文档……</Text>
          </Stack>
        </Center>
      )}
      <div
        id="onlyoffice-editor"
        style={{ width: "100%", height: session ? "100vh" : 0 }}
      />
    </Stack>
  );
}

function loadOnlyOfficeScript(src: string): Promise<void> {
  if (window.DocsAPI) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-onlyoffice-api="true"]`,
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Script load failed")),
        { once: true },
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.onlyofficeApi = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Script load failed"));
    document.head.appendChild(script);
  });
}
