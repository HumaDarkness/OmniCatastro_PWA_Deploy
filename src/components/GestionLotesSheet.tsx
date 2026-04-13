import * as React from "react"
import { useMediaQuery } from "usehooks-ts"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer"

interface GestionLotesSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function GestionLotesSheet({ open, onOpenChange, children }: GestionLotesSheetProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-2xl flex items-center space-x-2">
              <span>⚙️</span>
              <span>Gestión Avanzada de Lotes</span>
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col space-y-6">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b pb-4 mb-4">
          <DrawerTitle className="text-xl flex items-center justify-center space-x-2">
            <span>⚙️</span>
            <span>Gestión Avanzada de Lotes</span>
          </DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col space-y-4 px-4 pb-8 overflow-y-auto">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
