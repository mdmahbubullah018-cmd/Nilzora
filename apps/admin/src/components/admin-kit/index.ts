/*
 * The admin kit: building blocks for the admin and moderator pages, on top of
 * @nilzora/ui. Everything here renders on the server and works without JavaScript
 * (links and GET forms) except ConfirmForm's and the shell's small enhancements.
 *
 * Server-only data access lives in ./read (adminRead), which is not re-exported here
 * so client components can import this module.
 */
export { BarList, type BarListItem, type BarListProps } from './charts/bar-list';
export { AreaChart, BarChart, type CartesianChartProps, type ChartPoint } from './charts/cartesian';
export { DonutChart, type DonutChartProps, type DonutSegment } from './charts/donut-chart';
export { Sparkline, type SparklineProps } from './charts/sparkline';
export { CHART_SERIES, CHART_TONES, seriesTone, type ChartTone } from './charts/tones';
export { Chip, type ChipProps } from './chip';
export { ConfirmForm, type ConfirmFormProps } from './confirm-form';
export {
  DataTable,
  DataTableEmpty,
  DataTableLoading,
  parseSort,
  SortableHead,
  sortParam,
  type DataTableEmptyProps,
  type DataTableProps,
  type SortableHeadProps,
  type SortDirection,
  type SortState,
} from './data-table';
export {
  ChartSkeleton,
  FormSkeleton,
  InlineSpinner,
  ListSkeleton,
  LoadingOverlay,
  PageLoader,
  SectionLoader,
  StatTilesSkeleton,
} from './loaders';
export {
  AnalyticsSkeleton,
  CardGridSkeleton,
  DashboardSkeleton,
  DetailSkeleton,
  EditorSkeleton,
  FilterPanelSkeleton,
  InboxSkeleton,
  ListPageSkeleton,
  MediaLibrarySkeleton,
  OperationsSkeleton,
  PageHeadingSkeleton,
  PageSkeleton,
  ProfileSkeleton,
  SectionSkeleton,
  SettingsSkeleton,
  TableSkeleton,
  type PageSkeletonVariant,
  type TableSkeletonProps,
} from './skeletons';
export { RouteProgress } from './route-progress';
export { ExportMenu, type ExportMenuProps } from './export-menu';
export { reportDownloadHref } from '@/lib/report-download';
export { DetailList, type DetailItem, type DetailListProps } from './detail-list';
export {
  DateFilter,
  FilterBar,
  FilterChips,
  SearchFilter,
  SelectFilter,
  Toolbar,
  type DateFilterProps,
  type FilterBarProps,
  type FilterChip,
  type FilterChipsProps,
  type FilterOption,
  type SearchFilterProps,
  type SelectFilterProps,
  type ToolbarProps,
} from './filter-bar';
export { oneOf, pageParam, single, withQuery, type QueryValue } from './href';
export { GlassPanel, type GlassPanelProps } from './glass-panel';
export { KpiCard, type KpiCardProps, type KpiChange, type KpiTone } from './kpi-card';
export { MetricTile, type MetricTileProps } from './metric-tile';
export { PageToolbar, type PageToolbarProps } from './page-toolbar';
export { Pagination, pageWindow, rangeSummary, type PaginationProps } from './pagination';
export { SectionCard, type SectionCardProps } from './section-card';
export { SegmentedNav, type SegmentedNavOption, type SegmentedNavProps } from './segmented-nav';
export { STATUS_TONES, type StatusTone } from './status-tones';
export { Tabs, type TabItem, type TabsProps } from './tabs';
export {
  ErrorState,
  ForbiddenState,
  NotFoundState,
  RateLimitedState,
  ReadState,
  UnavailableState,
  type ForbiddenStateProps,
  type RateLimitedStateProps,
  type ReadFailure,
  type ReadStateProps,
  type StateMessageProps,
  type UnavailableStateProps,
} from './states';
export {
  ACCOUNT_STATUS,
  AccountStatusBadge,
  MODERATION_STATUS,
  MODERATION_TASK_STATUS,
  ModerationStatusBadge,
  ModerationTaskStatusBadge,
  ORDER_STATUS,
  ORDER_STATUS_CHART_TONE,
  OrderStatusBadge,
  PAYMENT_STATUS,
  PaymentStatusBadge,
  PRODUCT_STATUS,
  ProductStatusBadge,
  RoleBadge,
  StockBadge,
  stockLevel,
  type StockLevel,
} from './status-badge';
export {
  ComboChart,
  type ComboChartProps,
  type ComboPoint,
  type ComboSeries,
} from './charts/combo-chart';
export {
  StackedBarChart,
  type StackedBarChartProps,
  type StackedBarDatum,
  type StackedSeries,
} from './charts/stacked-bar-chart';
export { RadialProgress, type RadialProgressProps } from './charts/radial-progress';
export { Heatmap, type HeatmapCell, type HeatmapProps } from './charts/heatmap';
export { Funnel, type FunnelProps, type FunnelStage } from './charts/funnel';
export { CountUp, type CountUpKind, type CountUpProps } from './count-up';
