import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatabaseTableAccordion from "../DatabaseTableAccordion";
import { useAnalysisStore } from "../../store/analysis";

const columns = [
  { name: "id", type: "int", is_class_name: false, is_primary_key: true },
  {
    name: "class_name",
    type: "varchar",
    is_class_name: true,
    is_primary_key: false,
  },
  { name: "email", type: "varchar", is_class_name: false, is_primary_key: false },
];

function mockFields({ reject = false } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (reject) throw new Error("字段加载失败");
    return {
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response;
  });
}

describe("DatabaseTableAccordion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      selectedTables: new Map(),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
      maxTables: 10,
    });
  });

  it("selects only semantic dimensions and lets users clear them", async () => {
    mockFields();
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    expect(screen.getByRole("button", { name: "展开 users 字段" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));

    expect(await screen.findByRole("region", { name: "users 字段列表" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "全选 users 字段" }));
    expect(screen.getByRole("checkbox", { name: "字段 email" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "字段 id" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "字段 class_name" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "取消全选 users 字段" }));
    expect(screen.getByRole("checkbox", { name: "字段 email" })).not.toBeChecked();
  });

  it("selects, loads, and expands an unselected table from its expand button", async () => {
    // This fails if expand remains disabled until the separate checkbox flow completes.
    mockFields();
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    await user.click(
      screen.getByRole("button", { name: "展开 users 字段" }),
    );

    expect(
      await screen.findByRole("region", { name: "users 字段列表" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "选择表 users" }),
    ).toBeChecked();
  });

  it("shows visible per-table status while its fields are loading", async () => {
    // This fails if pending state is communicated only by disabled controls.
    let resolveFields!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFields = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));

    expect(screen.getByText("正在加载 users 字段…")).toBeVisible();

    resolveFields({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);
    expect(
      await screen.findByRole("region", { name: "users 字段列表" }),
    ).toBeVisible();
  });

  it("shows system-field purpose without making it an optional dimension", async () => {
    mockFields();
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));
    await screen.findByRole("region", { name: "users 字段列表" });

    const id = screen.getByRole("checkbox", { name: "字段 id" });
    const className = screen.getByRole("checkbox", { name: "字段 class_name" });
    expect(id).toBeDisabled();
    expect(className).toBeDisabled();
    expect(id).not.toBeChecked();
    expect(className).not.toBeChecked();
    expect(screen.getByText("自动用于实体 ID")).toBeVisible();
    expect(screen.getByText("用于节点展示")).toBeVisible();

    const email = screen.getByRole("checkbox", { name: "字段 email" });
    await user.click(email);
    expect(email).toBeChecked();
  });

  it("retries selecting a table after its field request fails", async () => {
    // This fails if a failed field request cannot be retried from the table row.
    mockFields({ reject: true });
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));
    expect(await screen.findByText("字段加载失败")).toBeVisible();

    mockFields();
    await user.click(screen.getByRole("button", { name: "重试 users 字段加载" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "users 字段列表" })).toBeVisible();
    });
  });

  it("prevents a second retry while a field request is pending", async () => {
    // This fails if repeated retry clicks can race and replace a successful selection with an error.
    useAnalysisStore.setState({
      tableErrors: new Map([["users", "字段加载失败"]]),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => {})
    );
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    const retry = screen.getByRole("button", { name: "重试 users 字段加载" });
    await user.click(retry);
    await user.click(retry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables an unselected table at the table selection limit", () => {
    // This fails if an eleventh table remains selectable.
    const selectedTables = new Map(
      Array.from({ length: 10 }, (_, index) => [
        `table_${index}`,
        { name: `table_${index}`, columns, selectedFields: new Set(["id", "class_name"]) },
      ])
    );
    useAnalysisStore.setState({ selectedTables, maxTables: 10 });

    render(<DatabaseTableAccordion tableName="users" disabled />);

    expect(screen.getByRole("checkbox", { name: "选择表 users" })).toBeDisabled();
  });

  it("collapses when its table is deselected", async () => {
    // This fails if stale field controls stay open after removing a table.
    mockFields();
    const user = userEvent.setup();
    render(<DatabaseTableAccordion tableName="users" disabled={false} />);

    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));
    await screen.findByRole("region", { name: "users 字段列表" });
    await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));

    expect(screen.queryByRole("region", { name: "users 字段列表" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 users 字段" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
