# 移动端与 PC 端自动适配方案（CSS 优先 + 脚本增强）

目标：在手机、平板与桌面端提供一致、清晰、可触达的体验；CSS 响应式为主，必要时用脚本修正浏览器差异与动态能力（图表像素比、视口高度等）。

## 1. 适配原则
- CSS 优先：流式布局 + 栅格（Grid/Flex）+ 媒体查询。
- 渐进增强：支持则启用（如容器查询、PWA、FS API），不支持则兜底。
- 一致交互：粗指针（触屏）与细指针（鼠标）差异化命中区域与悬停行为。
- 性能优先：避免布局抖动与大面积重排，脚本仅在必要时介入。

## 2. 断点与布局
- 断点建议：
  - `xs < 480px`（窄手机）
  - `sm 480–768px`（手机/小平板）
  - `md 768–1024px`（平板/小屏桌面）
  - `lg 1024–1440px`（主流桌面）
  - `xl > 1440px`（宽屏桌面）
- 布局策略：
  - 导航：`xs/sm` 使用底部或抽屉式导航，`md+` 使用侧栏 + 顶栏。
  - 页面：主内容区采用 Grid，左右栏在 `md+` 才显示。
  - 表单：单列（`xs/sm`）→ 双列（`md+`）。

示例（片段）：
```css
/* 流式 + 栅格 */
.page { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 768px){ .page { grid-template-columns: 240px 1fr; }}

/* 命中区域与字体 */
:root { --space: 12px; --radius: 10px; }
@media (min-width: 1024px){ :root { --space: 14px; --radius: 12px; }}
button, .tappable { min-height: 44px; padding: 0 14px; }

/* 图表容器随断点伸缩 */
.chart { height: 240px; }
@media (min-width: 768px){ .chart { height: 320px; }}
@media (min-width: 1440px){ .chart { height: 420px; }}
```

## 3. 字体与尺寸缩放
- 字号采用 `clamp` 约束：
```css
html { font-size: clamp(14px, 1.8vw, 18px); }
```
- 间距与圆角统一使用 CSS 变量，断点上调，保证视觉一致性。

## 4. 视口高度与安全区域（脚本增强）
- iOS Safari 的 `100vh` 包含地址栏，导致可视高度波动。用脚本计算 `--vh`：
```js
function setVH(){
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
setVH();
window.addEventListener('resize', setVH);
```
```css
.full-height { height: calc(var(--vh) * 100); }
/* iOS 刘海屏安全区 */
.page { padding-bottom: max(var(--space), env(safe-area-inset-bottom)); }
```

## 5. 指针类型与悬停能力
```css
/* 触屏：扩大命中区域，禁用复杂 hover 菜单 */
@media (hover: none) and (pointer: coarse){
  .menu:hover .submenu { display:none; }
  .tappable { min-height: 48px; }
}
/* 桌面：允许 hover 提示 */
@media (hover: hover) and (pointer: fine){ .tooltip:hover { opacity: 1; }}
```

## 6. 图表像素比校准（脚本增强）
Chart.js/ECharts 需考虑 `devicePixelRatio` 以提高清晰度：
```js
const dpr = Math.min(window.devicePixelRatio || 1, 2); // 上限 2 兼顾性能
chartInstance.resize({ devicePixelRatio: dpr });
```

## 7. 容器查询（可选增强）
支持的浏览器上，可使用容器查询替代部分断点：
```css
@container (min-width: 600px){ .card-list { grid-template-columns: repeat(2, 1fr); }}
```

## 8. 动态密度与列表模式（脚本增强，按需）
- 根据断点或用户偏好切换“紧凑/舒适”模式（行高、间距、列表密度）。
- 可用 `ResizeObserver` 监听容器宽度，更新 `data-density` 属性驱动样式。

## 9. 可访问性与主题
- 对比度达标、键盘可达、`prefers-color-scheme` 支持深色模式。
```css
@media (prefers-color-scheme: dark){ :root { color-scheme: dark; }}
```

## 10. 验收清单
- 设备：iPhone SE/Pro Max、iPad、安卓主流机、1080p/2K/4K 桌面。
- 浏览器：Safari(iOS/macOS)、Chrome、Edge、Firefox。
- 场景：
  - 首屏渲染无抖动（`--vh` 生效）；
  - 旋转屏幕布局稳定；
  - 触控命中≥44px；
  - 图表在高 DPI 清晰，缩放不失真；
  - 侧栏/底栏在断点处正确切换。

## 11. 结论
现有架构（UI 层 + 端口/适配器）完全支持移动端与 PC 自适配：以 CSS 响应式覆盖 80% 需求，使用少量脚本处理 100vh、DPR、密度切换与能力检测，确保跨设备一致体验。

