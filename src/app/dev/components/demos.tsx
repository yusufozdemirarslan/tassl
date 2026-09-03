'use client'

import { Info } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { stances } from './fixtures'

// Interactive demos live in one client component so the gallery page itself stays a server
// component. Fixture text is literal on purpose (jsx-no-literals is off for src/app/dev/**).
export function OverlayDemos() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dialog>
        <DialogTrigger render={<Button variant="secondary" />}>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock your decision?</DialogTitle>
            <DialogDescription>
              Locking is irreversible. Every claim below has a stance; the working clock stops.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Keep working</DialogClose>
            <Button>Lock decision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="destructive" />}>Void run</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this run?</AlertDialogTitle>
            <AlertDialogDescription>
              The student will be offered a new attempt. The trace is kept for the record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive">Void run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet>
        <SheetTrigger render={<Button variant="secondary" />}>Open sheet</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Action result</SheetTitle>
            <SheetDescription>
              What the verification returned, with the source document.
            </SheetDescription>
          </SheetHeader>
          <p className="text-body px-4">
            The Q3 volume figure in the memo is 12 % below the audited ledger.
          </p>
        </SheetContent>
      </Sheet>

      <Popover>
        <PopoverTrigger render={<Button variant="ghost" />}>Popover</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Why this claim matters</PopoverTitle>
            <PopoverDescription>
              It is load-bearing for the pricing recommendation.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon" aria-label="About the clock" />}
        >
          <Info aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>The clock is server time; the page only displays it.</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary" />}>Actions</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Claim actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Verify against the ledger</DropdownMenuItem>
          <DropdownMenuItem>Ask a stakeholder</DropdownMenuItem>
          <DropdownMenuItem>Escalate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="secondary"
        onClick={() => toast('Draft saved', { description: 'Autosaved at 14:02:11' })}
      >
        Show toast
      </Button>
    </div>
  )
}

export function FormDemos() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <FieldSet>
        <FieldLegend>Frame</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="demo-decision">Decision in one sentence</FieldLabel>
            <Input
              id="demo-decision"
              placeholder="We should hold the price and cut the promotion."
            />
            <FieldDescription>
              What you would tell the board before AI enters the room.
            </FieldDescription>
          </Field>
          <Field data-invalid>
            <FieldLabel htmlFor="demo-confidence">Confidence (0 to 100)</FieldLabel>
            <Input id="demo-confidence" defaultValue="140" aria-invalid inputMode="numeric" />
            <FieldError>Enter a number between 0 and 100.</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="demo-why">Why</FieldLabel>
            <Textarea id="demo-why" rows={3} placeholder="Two sentences at most." />
          </Field>
          <Field>
            <FieldLabel htmlFor="demo-disabled">Locked field</FieldLabel>
            <Input id="demo-disabled" disabled defaultValue="Hold price" />
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Choices</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="demo-stance">Stance</FieldLabel>
            <Select defaultValue="verify" items={stances}>
              <SelectTrigger id="demo-stance" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stances.map((stance) => (
                  <SelectItem key={stance.value} value={stance.value}>
                    {stance.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="demo-declare"
              defaultChecked
              aria-label="I used an outside tool during this run"
            />
            <FieldLabel htmlFor="demo-declare">I used an outside tool during this run</FieldLabel>
          </Field>
          <RadioGroup defaultValue="hold" aria-label="Recommendation">
            <Field orientation="horizontal">
              <RadioGroupItem value="hold" id="demo-hold" aria-label="Hold the price" />
              <FieldLabel htmlFor="demo-hold">Hold the price</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="cut" id="demo-cut" aria-label="Cut by 5 %" />
              <FieldLabel htmlFor="demo-cut">Cut by 5 %</FieldLabel>
            </Field>
          </RadioGroup>
          <Field orientation="horizontal">
            <Switch id="demo-copies" defaultChecked aria-label="Email copies of notifications" />
            <FieldLabel htmlFor="demo-copies">Email copies of notifications</FieldLabel>
          </Field>
        </FieldGroup>
      </FieldSet>

      <Tabs defaultValue="brief" className="md:col-span-2">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="log">Delegation log</TabsTrigger>
          <TabsTrigger value="frame">Frame</TabsTrigger>
        </TabsList>
        <TabsContent value="brief" className="text-body pt-3">
          Two columns of the working brief with word counts.
        </TabsContent>
        <TabsContent value="log" className="text-body pt-3">
          Every delegation with its why line and used marks.
        </TabsContent>
        <TabsContent value="frame" className="text-body pt-3">
          The locked frame, collapsible.
        </TabsContent>
      </Tabs>
    </div>
  )
}
