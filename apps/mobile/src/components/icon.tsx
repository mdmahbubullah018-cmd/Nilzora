import {
  ArrowLeft,
  ArrowUpDown,
  BadgeCheck,
  Banknote,
  Bell,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  CircleUserRound,
  Clock,
  CloudOff,
  CreditCard,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Headset,
  Heart,
  History,
  Ticket,
  House,
  Info,
  LayoutGrid,
  LifeBuoy,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Store,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Truck,
  Undo2,
  UserRound,
  X,
} from 'lucide-react-native';
import { createElement, type ComponentType } from 'react';
import { theme } from '@/theme';
import { CartGlyph as ShoppingCartGlyph } from './cart-glyph';

/*
 * The icon system
 * ---------------
 * Every icon in the app is a Lucide outline drawn at one of four sizes with one of two
 * stroke weights. Screens ask for a semantic name from `icons` and a size; they never pick
 * their own pixel size or stroke, which is what keeps the set looking like one family.
 *
 * Icons are decorative by default: the text next to them carries the meaning. Pass
 * `label` only when the icon is the control's only content — and prefer giving the control
 * itself an accessibilityLabel instead.
 */

export type IconSize = keyof typeof theme.icon.size;

/**
 * What every icon in the set accepts: Lucide's outline props, so the set can hold either a
 * Lucide icon or one of the app's own drawings such as the cart.
 */
type IconComponent = ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
  color?: string;
  fill?: string;
  accessible?: boolean;
}>;

/** The icon names the app uses, mapped to their Lucide components. */
export const icons = {
  home: House,
  categories: LayoutGrid,
  wishlist: Heart,
  voucher: Ticket,
  wishlistFilled: Heart,
  orders: Package,
  returns: Undo2,
  profile: UserRound,
  cart: ShoppingCartGlyph,
  account: CircleUserRound,
  payment: CreditCard,
  support: LifeBuoy,
  /** The same Message Circle outline the website's "Chat with us" launcher uses. */
  message: MessageCircle,
  shop: Store,
  search: Search,
  /** Passing a product on: the same Share 2 outline the website uses. */
  share: Share2,
  chevronRight: ChevronRight,
  back: ArrowLeft,
  sort: ArrowUpDown,
  filter: SlidersHorizontal,
  close: X,
  check: Check,
  plus: Plus,
  minus: Minus,
  remove: Trash2,
  edit: Pencil,
  show: Eye,
  hide: EyeOff,
  refresh: RefreshCw,
  location: MapPin,
  cash: Banknote,
  delivery: Truck,
  success: CircleCheck,
  alert: CircleAlert,
  notifications: Bell,
  settings: Settings2,
  help: Headset,
  history: History,
  offline: CloudOff,
  mail: Mail,
  phone: Phone,
  clock: Clock,
  globe: Globe,
  /** A review star: pass `filled` for a star that counts towards the rating. */
  star: Star,
  verified: BadgeCheck,
  /** A customer's verdict on somebody else's review. */
  like: ThumbsUp,
  dislike: ThumbsDown,
  /** The information pages, so each has its own recognisable glyph. */
  info: Info,
  question: CircleQuestionMark,
  shield: ShieldCheck,
  document: FileText,
} as const satisfies Record<string, IconComponent>;

export type IconName = keyof typeof icons;

export interface AppIconProps {
  name: IconName;
  size?: IconSize;
  /** Defaults to the body text colour; icons on dark surfaces pass white or the sky accent. */
  color?: string;
  /** Selected/active icons draw a little heavier, matching the tab bar. */
  active?: boolean;
  /** Draws a filled heart for a saved wishlist item. */
  filled?: boolean;
}

/** One icon from the shared set. Decorative: give the surrounding control the label. */
export function AppIcon({
  name,
  size = 'md',
  color = theme.colors.body,
  active = false,
  filled = false,
}: AppIconProps) {
  const Icon = icons[name];
  return createElement(Icon, {
    size: theme.icon.size[size],
    strokeWidth: active ? theme.icon.stroke.active : theme.icon.stroke.idle,
    color,
    fill: filled ? color : 'none',
    accessible: false,
  });
}
