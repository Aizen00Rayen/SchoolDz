import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ConfirmContext = createContext(null);

/**
 * Imperative in-app replacement for window.confirm(). Browsers silently
 * suppress native confirm() dialogs after a page triggers a few in a row
 * (Chrome's "Prevent this page from creating additional dialogs" checkbox) —
 * confirm() then just returns false with no visible feedback, which makes
 * every delete button gated on it look broken instead of erroring loudly.
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState(typeof options === "string" ? { description: options } : options);
    });
  }, []);

  const close = (result) => {
    setState(null);
    resolveRef.current?.(result);
    resolveRef.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!state} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title || "Are you sure?"}</AlertDialogTitle>
            {state?.description && (
              <AlertDialogDescription>{state.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {state?.cancelLabel || "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={state?.destructive ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground focus:ring-destructive" : undefined}
              data-testid="confirm-dialog-action"
            >
              {state?.confirmLabel || "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

// Returns confirm(options) => Promise<boolean> — options is either a plain
// description string or { title, description, confirmLabel, cancelLabel, destructive }.
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}
