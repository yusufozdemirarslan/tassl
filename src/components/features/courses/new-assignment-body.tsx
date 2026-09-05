'use client'

import { useId, useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { t } from '@/lib/i18n/messages/courses'
import { AssignmentForm } from './assignment-form'
import type { PackageVersionOption } from './package-version-option'

// UI-030 → Assignments → "New assignment", the half that only exists while the dialog is open
// (B4, see ./deferred-form): the whole configuration form, plus the one thing the form itself does
// not ask for, because an assignment screen never has to — which section the assignment belongs to.
//
// A course with one section states it rather than asking; a course with several asks, and changing
// the answer remounts the form (`key`), so a half-typed configuration never lands on a section the
// person has since moved away from.

export type NewAssignmentBodyProps = {
  sections: readonly { id: string; name: string }[]
  packageVersions: readonly PackageVersionOption[]
  courseDefaultWeight: number
}

export function NewAssignmentBody({
  sections,
  packageVersions,
  courseDefaultWeight,
}: NewAssignmentBodyProps) {
  const fieldId = useId()
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '')
  const only = sections.length === 1 ? sections[0] : undefined

  const selectId = `${fieldId}-section`
  const hintId = `${selectId}-hint`
  const items = sections.map((section) => ({ value: section.id, label: section.name }))

  return (
    <div className="flex flex-col gap-5">
      {only ? (
        <p className="text-ink-muted text-body">
          {t('courses.assignmentSectionOne', { name: only.name })}
        </p>
      ) : (
        <Field>
          <FieldLabel htmlFor={selectId}>{t('courses.assignmentSectionLabel')}</FieldLabel>
          <Select
            items={items}
            value={sectionId}
            onValueChange={(value: string | null) => setSectionId(value ?? '')}
          >
            <SelectTrigger id={selectId} className="w-full" aria-describedby={hintId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription id={hintId}>{t('courses.assignmentSectionHint')}</FieldDescription>
        </Field>
      )}

      <AssignmentForm
        key={sectionId}
        sectionId={sectionId}
        packageVersions={packageVersions}
        courseDefaultWeight={courseDefaultWeight}
      />
    </div>
  )
}
