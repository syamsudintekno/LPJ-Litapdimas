import {forwardRef} from 'react';
import styles from './Icons.module.css';
import KubaiArrowRight from 'kubai-icons-react/icons/arrow-right';
import KubaiCalendarRange from 'kubai-icons-react/icons/calendar-days';
import KubaiChevronLeft from 'kubai-icons-react/icons/chevron-left';
import KubaiChevronRight from 'kubai-icons-react/icons/chevron-right';
import KubaiClipboardList from 'kubai-icons-react/icons/clipboard';
import KubaiFolderOpen from 'kubai-icons-react/icons/folder-open';
import KubaiLayoutDashboard from 'kubai-icons-react/icons/layout-dashboard';
import KubaiLogOut from 'kubai-icons-react/icons/log-out';
import KubaiMenu from 'kubai-icons-react/icons/menu';
import KubaiRefreshCw from 'kubai-icons-react/icons/rotate-cw';
import KubaiSearch from 'kubai-icons-react/icons/search';
import KubaiUsers from 'kubai-icons-react/icons/users';
import KubaiPlus from 'kubai-icons-react/icons/plus-square';
import KubaiReceiptText from 'kubai-icons-react/icons/receipt';
import KubaiTrash2 from 'kubai-icons-react/icons/trash';
import KubaiBookOpen from 'kubai-icons-react/icons/book-open';
import KubaiSave from 'kubai-icons-react/icons/save';
import KubaiPrinter from 'kubai-icons-react/icons/printer';
import KubaiUpload from 'kubai-icons-react/icons/file-text-up';
import KubaiCheck from 'kubai-icons-react/icons/clipboard-check';
import KubaiClose from 'kubai-icons-react/icons/circle-x';
import KubaiPencil from 'kubai-icons-react/icons/pencil';
import KubaiWallet from 'kubai-icons-react/icons/wallet';
import KubaiShieldCheck from 'kubai-icons-react/icons/shield-check';
import KubaiFileText from 'kubai-icons-react/icons/file-text';
import KubaiEye from 'kubai-icons-react/icons/eye';

// UI icons accompany text or a named control; keep their SVGs out of the tab order.
// Static rendering avoids incidental tap toggles and respects reduced-motion/print use.
function decorative(Icon) {
  return forwardRef(function UiIcon({size = 18, className, ...props}, ref) {
    return <Icon {...props} ref={ref} size={size} variant="soft" trigger="none"
      className={[styles.icon, className].filter(Boolean).join(' ')} data-ui-icon=""
      aria-hidden="true" focusable="false" />;
  });
}

export const ArrowRight = decorative(KubaiArrowRight);
export const CalendarRange = decorative(KubaiCalendarRange);
export const ChevronLeft = decorative(KubaiChevronLeft);
export const ChevronRight = decorative(KubaiChevronRight);
export const ClipboardList = decorative(KubaiClipboardList);
export const FolderOpen = decorative(KubaiFolderOpen);
export const LayoutDashboard = decorative(KubaiLayoutDashboard);
export const LogOut = decorative(KubaiLogOut);
export const Menu = decorative(KubaiMenu);
export const RefreshCw = decorative(KubaiRefreshCw);
export const Search = decorative(KubaiSearch);
export const Users = decorative(KubaiUsers);
export const Plus = decorative(KubaiPlus);
export const ReceiptText = decorative(KubaiReceiptText);
export const Trash2 = decorative(KubaiTrash2);
export const BookOpen = decorative(KubaiBookOpen);
export const Save = decorative(KubaiSave);
export const Printer = decorative(KubaiPrinter);
export const Upload = decorative(KubaiUpload);
export const Check = decorative(KubaiCheck);
export const Close = decorative(KubaiClose);
export const Pencil = decorative(KubaiPencil);
export const Wallet = decorative(KubaiWallet);
export const ShieldCheck = decorative(KubaiShieldCheck);
export const FileText = decorative(KubaiFileText);
export const Eye = decorative(KubaiEye);
