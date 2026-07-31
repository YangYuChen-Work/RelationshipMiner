# AI Graph Frontend

React 前端应用，提供数据库表与字段选择界面、分析进度展示，以及基于 Canvas 2D 的交互式关系星云图谱。

## 技术栈

- React 19 + TypeScript 6
- Canvas 2D 渲染（D3.js 力导向布局 + Web Worker）
- Tailwind CSS 4
- Zustand 5 状态管理

## 开发

```powershell
npm ci
npm run dev
```

## 测试

```powershell
npm test
npm run test:watch
```

## 构建

```powershell
npm run build
```

## 可视化回归测试

开发用可视化工具，不参与生产构建：

```
/visual-test.html?size=20   # 20 节点场景
/visual-test.html?size=200  # 200 节点场景
```
