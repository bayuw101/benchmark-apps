"use client";

import { useState } from "react";
import { Globe, KeyRound, Save, Tag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InputField } from "@/components/arbiter/input-field";
import { SelectField } from "@/components/arbiter/select-field";
import { TextareaField } from "@/components/arbiter/textarea-field";
import { FormSection } from "@/components/arbiter/form-section";
import { Demo, GallerySection } from "./section";

const PRESETS = [
  { value: "smoke", label: "Smoke", description: "1–2 VUs, checks the script runs" },
  { value: "baseline", label: "Baseline", description: "Normal traffic, sets the reference" },
  { value: "peak", label: "Peak", description: "Expected game-day peak" },
  { value: "spike", label: "Spike", description: "Sudden surge before kickoff" },
  { value: "stress", label: "Stress", description: "Above peak, staging only" },
];

const NETWORK = [
  { value: "4g", label: "Stadium 4G" },
  { value: "wifi", label: "Wi-Fi baseline" },
];

export function FieldsSection() {
  const [preset, setPreset] = useState("peak");
  return (
    <GallerySection id="fields" title="Fields and forms" description="Floating labels: the label is the placeholder. No native validation. Errors come from the server, shown as a red border, ring, label and micro text.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Demo label="InputField states">
          <InputField label="Release ID" />
          <InputField label="Target hostname" defaultValue="tickets.staging.arbiter.internal" icon={<Globe />} />
          <InputField label="Reference peak (RPS)" defaultValue="12x" error="Enter a whole number, e.g. 1200" />
          <InputField label="Health endpoint" hint="Polled every 5 s during the run" />
          <InputField label="Access token" type="password" defaultValue="secretvalue" icon={<KeyRound />} />
          <InputField label="Environment" defaultValue="staging" disabled />
        </Demo>
        <Demo label="Select, textarea, toggles">
          <SelectField label="Load preset" options={PRESETS} value={preset} onChange={setPreset} />
          <SelectField label="Network profile" options={NETWORK} icon={<Tag />} />
          <SelectField label="Scenario" options={[]} error="Choose a scenario" />
          <TextareaField label="Notes for the approver" />
          <div className="flex flex-wrap items-center gap-5 pt-1">
            <div className="flex items-center gap-2">
              <Switch id="g-switch" defaultChecked />
              <Label htmlFor="g-switch" className="text-xs">Capture browser metrics</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="g-check" defaultChecked />
              <Label htmlFor="g-check" className="text-xs">Run cleanup hook</Label>
            </div>
          </div>
        </Demo>
      </div>
      <FormSection
        title="Load profile"
        description="What the run sends to the target. Changing it after approval needs re-approval."
        actions={<Button size="sm" variant="ghost" icon={<X />}>Reset</Button>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField label="Load preset" options={PRESETS} defaultValue="baseline" />
          <SelectField label="Network profile" options={NETWORK} />
          <InputField label="Release ID" hint="Optional. Links results to a release." />
          <InputField label="Duration (minutes)" defaultValue="15" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" icon={<Save />}>Save plan</Button>
        </div>
      </FormSection>
    </GallerySection>
  );
}
