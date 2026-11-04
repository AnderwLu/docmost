import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import McpAuthorizationPage from "./mcp-authorization-page";
import McpConnections from "./mcp-connections";
import api from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});
function consent() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/mcp/authorize/request-id"]}>
        <Routes>
          <Route
            path="/mcp/authorize/:requestId"
            element={<McpAuthorizationPage />}
          />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}
describe("MCP OAuth screens", () => {
  it("shows loading then the existing knowledge-base identity and client", async () => {
    let resolve: (value: unknown) => void;
    vi.mocked(api.get).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    consent();
    expect(screen.getByLabelText("正在加载授权请求")).toBeTruthy();
    resolve!({
      data: {
        clientName: "Client A",
        redirect: "http://localhost:12345/callback",
        user: {
          id: "user-1",
          workspaceId: "workspace-1",
          name: "Ada",
          email: "ada@example.test",
        },
        workspaceName: "知识库 A",
      },
    });
    expect(await screen.findByText(/ada@example.test/)).toBeTruthy();
    expect(screen.getByText("Client A")).toBeTruthy();
    expect(screen.getByRole("button", { name: "允许访问" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
  });
  it("shows an actionable error for expired requests", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("expired"));
    consent();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "允许访问" })).toBeNull();
  });
  it("does not silently grant access; failed approval offers a reconnect message", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        clientName: "Client",
        redirect: "https://chatgpt.com/callback",
        user: {
          id: "user-1",
          workspaceId: "workspace-1",
          name: "Ada",
          email: "ada@example.test",
        },
        workspaceName: "Docs",
      },
    });
    vi.mocked(api.post).mockRejectedValue(new Error("expired"));
    consent();
    fireEvent.click(await screen.findByRole("button", { name: "允许访问" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/mcp-oauth/requests/request-id", {
        approved: true,
        userId: "user-1",
        workspaceId: "workspace-1",
      }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
  it("lists and revokes a connection, then shows empty state", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        data: [
          {
            id: "grant-id",
            clientName: "Client A",
            createdAt: 0,
            expiresAt: Date.now() + 60000,
          },
        ],
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: [] });
    render(
      <MantineProvider>
        <McpConnections />
      </MantineProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "撤销授权" }));
    expect(await screen.findByText("暂无授权连接。")).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith("/mcp-oauth/grants/grant-id/revoke");
  });
});
