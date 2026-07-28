import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FieldSelector from "../FieldSelector";
import { useAnalysisStore } from "../../store/analysis";
import type { ColumnInfo } from "../../api/tables";

const makeColumns = (): ColumnInfo[] => [
  { name: "id", type: "int", is_class_name: false, is_primary_key: false },
  { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
  { name: "name", type: "varchar", is_class_name: false, is_primary_key: false },
  { name: "email", type: "varchar", is_class_name: false, is_primary_key: false },
];

describe("FieldSelector", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      selectedTables: new Map(),
    });
  });

  it("shows empty state when no tables are selected", () => {
    render(<FieldSelector />);
    expect(
      screen.getByText("请先在上方选择要分析的数据表")
    ).toBeInTheDocument();
  });

  it("renders fields grouped by table", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("class_name")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("shows class_name badge on identified fields", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    const badges = screen.getAllByText("类名");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("class_name checkbox is disabled and pre-selected", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    // At least the class_name checkbox should be disabled
    const allCheckboxes = screen.getAllByRole("checkbox");
    expect(allCheckboxes.length).toBe(4); // id, class_name, name, email
  });

  it("toggles field selection on click", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    // Find the "name" field label and click it
    const nameLabel = screen.getByText("name").closest("label");
    expect(nameLabel).not.toBeNull();
    if (nameLabel) {
      const checkbox = nameLabel.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      expect(checkbox).not.toBeNull();
    }

    // After clicking name label, it should be selected
    fireEvent.click(nameLabel!);

    const usersEntry = useAnalysisStore
      .getState()
      .selectedTables.get("users");
    expect(usersEntry?.selectedFields.has("name")).toBe(true);
  });

  it("shows select all / deselect all button", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    expect(screen.getByText("全选")).toBeInTheDocument();
  });

  it("select all selects all fields", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    fireEvent.click(screen.getByText("全选"));

    const entry = useAnalysisStore.getState().selectedTables.get("users");
    expect(entry?.selectedFields.size).toBe(4);
    expect(screen.getByText("取消全选")).toBeInTheDocument();
  });

  it("shows field count ratio", () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: makeColumns(),
            selectedFields: new Set(["class_name", "name"]),
          },
        ],
      ]),
    });

    render(<FieldSelector />);

    expect(screen.getByText("2/4")).toBeInTheDocument();
  });
});
