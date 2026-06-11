/**
 * RevenueCat client wrapper.
 *
 * Goals:
 * - Hide all platform/availability detection from the rest of the app.
 * - Initialize once per Firebase UID.
 * - Expose `isPro` via the `pro_access` entitlement.
 * - Provide a safe no-op fallback in Expo Go (where the native module is not
 *   available) so the app still boots — the mock paywall path keeps working.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const REVENUECAT_API_KEY = 'test_yZlTasMXWXdgOiZRiZhMZatGEWY';
export const PRO_ENTITLEMENT = 'pro_access';

const isExpoGo = Constants.appOwnership === 'expo';

// In Expo Go the native module is missing — requiring the package would
// throw at runtime. Use a dynamic require gated by an env check so Metro
// still bundles cleanly.
let Purchases: any = null;
let nativeImportError: Error | null = null;
if (Platform.OS !== 'web' && !isExpoGo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Purchases = require('react-native-purchases').default;
  } catch (e) {
    nativeImportError = e as Error;
  }
}

export const isRevenueCatAvailable = () => Purchases !== null;
export const revenueCatUnavailableReason = () => {
  if (Platform.OS === 'web') return 'web (Web Billing not configured)';
  if (isExpoGo) return 'Expo Go (native module not loadable)';
  if (nativeImportError) return `import error: ${nativeImportError.message}`;
  return 'unknown';
};

let configuredUid: string | null = null;

export async function configureForUser(uid: string) {
  if (!Purchases || configuredUid === uid) return;
  try {
    await Purchases.configure({ apiKey: REVENUECAT_API_KEY, appUserID: uid });
    configuredUid = uid;
  } catch (e) {
    console.warn('[RevenueCat] configure failed', e);
  }
}

export async function getCustomerInfo(): Promise<any | null> {
  if (!Purchases) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    console.warn('[RevenueCat] getCustomerInfo failed', e);
    return null;
  }
}

export function hasProAccess(info: any | null | undefined): boolean {
  if (!info) return false;
  try {
    return typeof info.entitlements?.active?.[PRO_ENTITLEMENT] !== 'undefined';
  } catch {
    return false;
  }
}

export async function getDefaultOffering(): Promise<any | null> {
  if (!Purchases) return null;
  try {
    const o = await Purchases.getOfferings();
    return o.current ?? null;
  } catch (e) {
    console.warn('[RevenueCat] getOfferings failed', e);
    return null;
  }
}

export async function purchaseByIdentifier(
  identifier: '$monthly' | '$annual',
): Promise<{ ok: boolean; isPro: boolean; reason?: string }> {
  if (!Purchases) {
    return { ok: false, isPro: false, reason: 'unavailable' };
  }
  const offering = await getDefaultOffering();
  if (!offering) return { ok: false, isPro: false, reason: 'no-offering' };
  const pkg = offering.availablePackages.find((p: any) => p.identifier === identifier);
  if (!pkg) return { ok: false, isPro: false, reason: `no-${identifier}-package` };
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPro: hasProAccess(customerInfo) };
  } catch (e: any) {
    // user cancellation is a normal flow — surface as ok=false but no error log
    if (e?.userCancelled) {
      return { ok: false, isPro: false, reason: 'cancelled' };
    }
    console.warn('[RevenueCat] purchase failed', e);
    return { ok: false, isPro: false, reason: e?.message ?? 'purchase-error' };
  }
}

export function addCustomerInfoUpdateListener(
  cb: (info: any) => void,
): () => void {
  if (!Purchases) return () => {};
  Purchases.addCustomerInfoUpdateListener(cb);
  return () => Purchases.removeCustomerInfoUpdateListener(cb);
}
