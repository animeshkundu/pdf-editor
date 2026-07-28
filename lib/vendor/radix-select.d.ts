import type {
  ComponentPropsWithoutRef,
  ForwardRefExoticComponent,
  HTMLAttributes,
  ReactNode,
  RefAttributes,
} from 'react';

// Radix Select 2.3.x publishes an `onPlaced` intersection that TypeScript 6 rejects
// under exact optional properties. Keep this compatibility declaration limited to the
// primitives used here; Vite still resolves the package's real runtime entry.
export interface SelectRootProps {
  readonly children?: ReactNode;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly disabled?: boolean;
  readonly name?: string;
}

export const Root: (props: SelectRootProps) => ReactNode;
export const Trigger: ForwardRefExoticComponent<
  ComponentPropsWithoutRef<'button'> & RefAttributes<HTMLButtonElement>
>;
export const Value: (props: { readonly placeholder?: ReactNode }) => ReactNode;
export const Icon: (props: { readonly children?: ReactNode }) => ReactNode;
export const Portal: (props: {
  readonly children?: ReactNode;
  readonly container?: HTMLElement;
}) => ReactNode;
export const Content: ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    readonly position?: 'item-aligned' | 'popper';
    readonly sideOffset?: number;
  } & RefAttributes<HTMLDivElement>
>;
export const Viewport: ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & RefAttributes<HTMLDivElement>
>;
export const Item: ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    readonly value: string;
    readonly disabled?: boolean;
    readonly textValue?: string;
  } & RefAttributes<HTMLDivElement>
>;
export const ItemText: (props: { readonly children?: ReactNode }) => ReactNode;
export const ItemIndicator: (props: { readonly children?: ReactNode }) => ReactNode;
