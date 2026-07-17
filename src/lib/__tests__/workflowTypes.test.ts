import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_WORKFLOW_STEPS,
  bindingKey,
  createDefaultWorkflow,
  extractPromptVariables,
  getAvailableBindings,
  getBindingValueType,
  isValidRunUntilTarget,
  isWorkflowTypeCompatible,
  prepareWorkflowRunForRetry,
  renderPromptTemplate,
  resolveWorkflowBinding,
  shouldStopAfterWorkflowStep,
  toPublicWorkflowRun,
  toWorkflowRunSummary,
  validateWorkflow,
  type WorkflowDraft,
  type WorkflowImageNode,
  type WorkflowPromptNode,
  type WorkflowReverseNode,
  type WorkflowRun,
  type WorkflowStepRun,
} from "../workflowTypes.ts";

function cloneDraft(draft: WorkflowDraft): WorkflowDraft {
  return structuredClone(draft);
}

function issueCodes(draft: WorkflowDraft): string[] {
  return validateWorkflow(draft).map((issue) => issue.code);
}

test("createDefaultWorkflow builds a valid five-step reverse-to-generation flow", () => {
  const draft = createDefaultWorkflow("商品图自动生成");

  assert.equal(draft.name, "商品图自动生成");
  assert.deepEqual(draft.nodes.map((node) => node.type), ["input", "reverse", "prompt", "image", "output"]);
  assert.equal(new Set(draft.nodes.map((node) => node.id)).size, 5);
  assert.deepEqual(validateWorkflow(draft), []);
  const output = draft.nodes.find((node) => node.type === "output");
  assert.ok(output && output.type === "output");
  assert.equal(output.config.selectIndex, undefined, "leaving selectIndex empty outputs the full image list");
});

test("run-until accepts only enabled targets and stops after success or skip", () => {
  const draft = createDefaultWorkflow();
  const target = draft.nodes[2];
  assert.equal(isValidRunUntilTarget(draft, target.id), true);
  target.enabled = false;
  assert.equal(isValidRunUntilTarget(draft, target.id), false);
  assert.equal(isValidRunUntilTarget(draft, "missing"), false);
  assert.equal(isValidRunUntilTarget(draft, undefined), true);

  const run = { stopAfterNodeId: target.id };
  assert.equal(shouldStopAfterWorkflowStep(run, target.id, "pending"), false);
  assert.equal(shouldStopAfterWorkflowStep(run, target.id, "running"), false);
  assert.equal(shouldStopAfterWorkflowStep(run, target.id, "success"), true);
  assert.equal(shouldStopAfterWorkflowStep(run, target.id, "skipped"), true);
  assert.equal(shouldStopAfterWorkflowStep(run, "other", "success"), false);
});

test("output selection validates list bounds and rejects indexes on a single image", () => {
  const draft = createDefaultWorkflow();
  const image = draft.nodes.find((node): node is WorkflowImageNode => node.type === "image");
  const output = draft.nodes.find((node) => node.type === "output");
  assert.ok(image && output?.type === "output");
  image.config.count = 2;
  output.config.selectIndex = 2;
  assert.ok(issueCodes(draft).includes("output.index_out_of_range"));

  output.config.images = { sourceNodeId: image.id, sourcePort: "images", index: 0 };
  output.config.selectIndex = 0;
  assert.ok(issueCodes(draft).includes("output.index_on_image"));
});

test("binding helpers preserve indexes and convert an indexed image list to one image", () => {
  const draft = createDefaultWorkflow();
  const imageNode = draft.nodes.find((node): node is WorkflowImageNode => node.type === "image");
  assert.ok(imageNode);

  const listBinding = { sourceNodeId: imageNode.id, sourcePort: "images" };
  const itemBinding = { ...listBinding, index: 2 };

  assert.equal(bindingKey(listBinding), `${imageNode.id}.images`);
  assert.equal(bindingKey(itemBinding), `${imageNode.id}.images[2]`);
  assert.equal(getBindingValueType(draft, listBinding), "images");
  assert.equal(getBindingValueType(draft, itemBinding), "image");
  assert.equal(getBindingValueType(draft, { sourceNodeId: imageNode.id, sourcePort: "missing" }), null);
});

test("resolveWorkflowBinding maps persisted step outputs and safely handles invalid selections", () => {
  const run = {
    workflowSnapshot: { nodes: [] },
    inputs: {},
    steps: [
      {
        nodeId: "image-step",
        outputs: {
          images: { type: "images", value: ["first.png", "second.png"] },
          label: { type: "text", value: "done" },
        },
      },
    ],
  } as unknown as WorkflowRun;

  assert.deepEqual(resolveWorkflowBinding(run, { sourceNodeId: "image-step", sourcePort: "images" }), {
    type: "images",
    value: ["first.png", "second.png"],
  });
  assert.deepEqual(resolveWorkflowBinding(run, { sourceNodeId: "image-step", sourcePort: "images", index: 1 }), {
    type: "image",
    value: "second.png",
  });
  assert.equal(resolveWorkflowBinding(run, { sourceNodeId: "image-step", sourcePort: "images", index: 9 }), undefined);
  assert.equal(resolveWorkflowBinding(run, { sourceNodeId: "image-step", sourcePort: "label", index: 0 }), undefined);
  assert.equal(resolveWorkflowBinding(run, { sourceNodeId: "missing-step", sourcePort: "images" }), undefined);
});

test("resolveWorkflowBinding can recover input values from the persisted run snapshot", () => {
  const run = {
    workflowSnapshot: {
      nodes: [
        {
          id: "input-step",
          type: "input",
          name: "任务输入",
          config: {
            fields: [
              { id: "description", name: "描述", type: "text", required: false, defaultValue: "fallback text" },
              { id: "reference", name: "参考图", type: "image", required: false },
            ],
          },
        },
      ],
    },
    inputs: {
      "input-step.description": "scoped text",
      reference: "reference.png",
    },
    steps: [{ nodeId: "input-step", outputs: {} }],
  } as unknown as WorkflowRun;

  assert.deepEqual(resolveWorkflowBinding(run, { sourceNodeId: "input-step", sourcePort: "description" }), {
    type: "text",
    value: "scoped text",
  });
  assert.deepEqual(resolveWorkflowBinding(run, { sourceNodeId: "input-step", sourcePort: "reference" }), {
    type: "image",
    value: "reference.png",
  });
  delete run.inputs.reference;
  assert.equal(resolveWorkflowBinding(run, { sourceNodeId: "input-step", sourcePort: "reference" }), undefined);
});

test("workflow type compatibility allows one image where an image list is accepted", () => {
  assert.equal(isWorkflowTypeCompatible("image", "images"), true);
  assert.equal(isWorkflowTypeCompatible("images", "image"), false);
  assert.equal(isWorkflowTypeCompatible("text", "image"), false);
  assert.equal(isWorkflowTypeCompatible("text", "text"), true);
});

test("getAvailableBindings only exposes enabled prior outputs with compatible types", () => {
  const draft = createDefaultWorkflow();
  const imageNode = draft.nodes.find((node): node is WorkflowImageNode => node.type === "image");
  const outputNode = draft.nodes.find((node) => node.type === "output");
  const reverseNode = draft.nodes.find((node): node is WorkflowReverseNode => node.type === "reverse");
  assert.ok(imageNode && outputNode && reverseNode);

  const textBindings = getAvailableBindings(draft, imageNode.id, ["text"]);
  assert.ok(textBindings.some((item) => item.nodeId === reverseNode.id && item.port === "prompt"));
  assert.ok(textBindings.every((item) => draft.nodes.findIndex((node) => node.id === item.nodeId) < draft.nodes.indexOf(imageNode)));
  assert.ok(textBindings.every((item) => item.type === "text"));

  const imageBindings = getAvailableBindings(draft, outputNode.id, ["image"]);
  const generatedImages = imageBindings.find((item) => item.nodeId === imageNode.id && item.port === "images");
  assert.ok(generatedImages);
  assert.equal(generatedImages.requiresIndex, true);

  reverseNode.enabled = false;
  assert.equal(getAvailableBindings(draft, imageNode.id, ["text"]).some((item) => item.nodeId === reverseNode.id), false);
});

test("extractPromptVariables deduplicates valid placeholders in encounter order", () => {
  assert.deepEqual(
    extractPromptVariables("{{ first }} / {{second.value}} / {{ first }} / {plain} / {{not valid!}}"),
    ["first", "second.value"],
  );
});

test("renderPromptTemplate replaces repeated variables, preserves plain braces, and trims the result", () => {
  assert.equal(
    renderPromptTemplate("  {{ subject }} + {{style}} + {{subject}} {literal}  ", {
      subject: "linen shirt",
      style: "studio light",
    }),
    "linen shirt + studio light + linen shirt {literal}",
  );
  assert.equal(renderPromptTemplate("before{{empty}}after", { empty: "" }), "beforeafter");
});

test("renderPromptTemplate reports every missing variable instead of emitting a partial prompt", () => {
  assert.throws(
    () => renderPromptTemplate("{{known}} {{missing}} {{other}} {{missing}}", { known: "ok" }),
    /提示词变量未绑定：missing、other/,
  );
});

test("validateWorkflow reports missing bindings, future references, and incompatible types", () => {
  const missing = createDefaultWorkflow();
  const missingReverse = missing.nodes.find((node): node is WorkflowReverseNode => node.type === "reverse");
  assert.ok(missingReverse);
  missingReverse.config.image = null;
  assert.ok(issueCodes(missing).includes("binding.required"));

  const future = createDefaultWorkflow();
  const futureReverse = future.nodes.find((node): node is WorkflowReverseNode => node.type === "reverse");
  const futureImage = future.nodes.find((node): node is WorkflowImageNode => node.type === "image");
  assert.ok(futureReverse && futureImage);
  futureReverse.config.image = { sourceNodeId: futureImage.id, sourcePort: "images", index: 0 };
  assert.ok(issueCodes(future).includes("binding.not_prior"));

  const wrongType = createDefaultWorkflow();
  const wrongReverse = wrongType.nodes.find((node): node is WorkflowReverseNode => node.type === "reverse");
  const inputNode = wrongType.nodes.find((node) => node.type === "input");
  assert.ok(wrongReverse && inputNode?.type === "input");
  wrongReverse.config.image = { sourceNodeId: inputNode.id, sourcePort: "customText" };
  assert.ok(issueCodes(wrongType).includes("binding.type"));
});

test("validateWorkflow reports prompt variable mistakes without treating warnings as errors", () => {
  const draft = createDefaultWorkflow();
  const promptNode = draft.nodes.find((node): node is WorkflowPromptNode => node.type === "prompt");
  assert.ok(promptNode);
  promptNode.config.template = "{{reversePrompt}} {{missingVariable}}";

  const issues = validateWorkflow(draft);
  assert.ok(issues.some((issue) => issue.code === "prompt.variable_missing" && issue.severity === "error"));
  assert.ok(issues.some((issue) => issue.code === "prompt.binding_unused" && issue.severity === "warning"));
});

test("validateWorkflow enforces output, step-count, and generation-combination boundaries", () => {
  const noOutput = createDefaultWorkflow();
  noOutput.nodes = noOutput.nodes.filter((node) => node.type !== "output");
  assert.ok(issueCodes(noOutput).includes("workflow.output_missing"));

  const tooMany = createDefaultWorkflow();
  const inputTemplate = tooMany.nodes.find((node) => node.type === "input");
  assert.ok(inputTemplate?.type === "input");
  while (tooMany.nodes.length <= MAX_WORKFLOW_STEPS) {
    const sequence = tooMany.nodes.length;
    tooMany.nodes.splice(tooMany.nodes.length - 1, 0, {
      ...structuredClone(inputTemplate),
      id: `extra-input-${sequence}`,
      name: `额外输入 ${sequence}`,
    });
  }
  assert.ok(issueCodes(tooMany).includes("workflow.too_many_steps"));

  const invalidCombo = createDefaultWorkflow();
  const imageNode = invalidCombo.nodes.find((node): node is WorkflowImageNode => node.type === "image");
  assert.ok(imageNode);
  imageNode.config.model = "GPT Image 2";
  imageNode.config.resolution = "512";
  imageNode.config.aspectRatio = "21:9";
  assert.ok(issueCodes(invalidCombo).includes("image.combo"));
});

test("validateWorkflow enforces the MVP's single enabled input and output nodes", () => {
  const twoInputs = createDefaultWorkflow();
  const inputNode = twoInputs.nodes.find((node) => node.type === "input");
  assert.ok(inputNode?.type === "input");
  twoInputs.nodes.splice(1, 0, {
    ...structuredClone(inputNode),
    id: "second-input",
    name: "第二组输入",
  });
  assert.ok(issueCodes(twoInputs).includes("workflow.input_count"));

  const twoOutputs = createDefaultWorkflow();
  const outputNode = twoOutputs.nodes.find((node) => node.type === "output");
  assert.ok(outputNode?.type === "output");
  twoOutputs.nodes.push({
    ...structuredClone(outputNode),
    id: "second-output",
    name: "第二组输出",
  });
  assert.ok(issueCodes(twoOutputs).includes("workflow.output_count"));

  const disabledExtras = createDefaultWorkflow();
  const disabledInput = structuredClone(disabledExtras.nodes.find((node) => node.type === "input"));
  const disabledOutput = structuredClone(disabledExtras.nodes.find((node) => node.type === "output"));
  assert.ok(disabledInput?.type === "input" && disabledOutput?.type === "output");
  disabledExtras.nodes.push(
    { ...disabledInput, id: "disabled-input", enabled: false },
    { ...disabledOutput, id: "disabled-output", enabled: false },
  );
  assert.equal(issueCodes(disabledExtras).includes("workflow.input_count"), false);
  assert.equal(issueCodes(disabledExtras).includes("workflow.output_count"), false);
});

test("toWorkflowRunSummary keeps status metadata and omits heavy run snapshots", () => {
  const now = Date.now();
  const draft = createDefaultWorkflow();
  const workflow = {
    ...draft,
    schemaVersion: 1 as const,
    id: "workflow-1",
    version: 3,
    createdAt: now - 100,
    updatedAt: now - 50,
  };
  const run: WorkflowRun = {
    id: "run-1",
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowName: workflow.name,
    workflowSnapshot: workflow,
    inputs: { customText: "red coat" },
    status: "failed",
    steps: [],
    outputs: {},
    currentNodeId: workflow.nodes[2].id,
    stopRequested: false,
    error: "upstream timeout",
    createdAt: now - 40,
    startedAt: now - 30,
    finishedAt: now,
    updatedAt: now,
  };

  const summary = toWorkflowRunSummary(run);
  assert.equal(summary.id, run.id);
  assert.equal(summary.workflowVersion, 3);
  assert.equal(summary.currentNodeId, run.currentNodeId);
  assert.equal(summary.error, "upstream timeout");
  assert.equal("workflowSnapshot" in summary, false);
  assert.equal("steps" in summary, false);
  assert.equal("inputs" in summary, false);
});

test("toPublicWorkflowRun redacts image data URLs everywhere without mutating durable state", () => {
  const now = Date.now();
  const draft = createDefaultWorkflow();
  const workflow = {
    ...draft,
    schemaVersion: 1 as const,
    id: "workflow-public",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const inputNode = workflow.nodes.find((node) => node.type === "input");
  assert.ok(inputNode?.type === "input");
  const sourceField = inputNode.config.fields.find((field) => field.id === "sourceImage");
  assert.ok(sourceField);
  sourceField.defaultValue = "data:image/png;base64,DEFAULT_SECRET";
  const run: WorkflowRun = {
    id: "run-public",
    workflowId: workflow.id,
    workflowVersion: 1,
    workflowName: workflow.name,
    workflowSnapshot: workflow,
    inputs: {
      sourceImage: "data:image/png;base64,INPUT_SECRET",
      customText: "keep this text",
    },
    status: "success",
    steps: workflow.nodes.map((node): WorkflowStepRun => ({
      nodeId: node.id,
      nodeType: node.type,
      name: node.name,
      status: "success" as const,
      attempts: 1,
      inputs: node.type === "image"
        ? {
            prompt: { type: "text" as const, value: "keep this prompt" },
            baseImage: { type: "image" as const, value: "data:image/png;base64,STEP_INPUT_SECRET" },
          }
        : undefined,
      outputs: node.type === "output"
        ? {
            result: {
              type: "images" as const,
              value: ["data:image/png;base64,STEP_OUTPUT_SECRET", "/api/media/result.png"],
            },
          }
        : {},
      upstreamJobs: node.type === "image"
        ? [{
            taskId: "upstream-1",
            status: "success" as const,
            progress: 1,
            images: ["data:image/png;base64,JOB_SECRET", "/api/media/job.png"],
          }]
        : undefined,
    })),
    outputs: {
      final: {
        type: "images",
        value: ["data:image/png;base64,FINAL_SECRET", "/api/media/final.png"],
      },
    },
    stopRequested: false,
    createdAt: now,
    updatedAt: now,
  };
  const durable = structuredClone(run);

  const publicRun = toPublicWorkflowRun(run);

  assert.deepEqual(run, durable);
  assert.equal(publicRun.inputs.sourceImage, "[data URL omitted]");
  assert.equal(publicRun.inputs.customText, "keep this text");
  assert.deepEqual(publicRun.outputs.final, {
    type: "images",
    value: ["[data URL omitted]", "/api/media/final.png"],
  });
  assert.equal(
    publicRun.workflowSnapshot.nodes
      .find((node) => node.type === "input")
      ?.config.fields.find((field) => field.id === "sourceImage")?.defaultValue,
    "[data URL omitted]",
  );
  assert.doesNotMatch(JSON.stringify(publicRun), /(?:INPUT|DEFAULT|STEP_INPUT|STEP_OUTPUT|JOB|FINAL)_SECRET/);
  assert.match(JSON.stringify(run), /INPUT_SECRET/);
});

test("prepareWorkflowRunForRetry reuses successful paid image submissions and resets downstream state", () => {
  const now = Date.now();
  const draft = createDefaultWorkflow();
  const workflow = {
    ...draft,
    schemaVersion: 1 as const,
    id: "workflow-retry",
    version: 1,
    createdAt: now - 1000,
    updatedAt: now - 900,
  };
  const [inputNode, reverseNode, promptNode, imageNode, outputNode] = workflow.nodes;
  const run: WorkflowRun = {
    id: "run-retry",
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowName: workflow.name,
    workflowSnapshot: workflow,
    inputs: { sourceImage: "data:image/png;base64,AAAA" },
    status: "failed",
    steps: [
      {
        nodeId: inputNode.id,
        nodeType: inputNode.type,
        name: inputNode.name,
        status: "success",
        attempts: 1,
        outputs: { sourceImage: { type: "image", value: "source.png" } },
      },
      {
        nodeId: reverseNode.id,
        nodeType: reverseNode.type,
        name: reverseNode.name,
        status: "success",
        attempts: 1,
        outputs: { prompt: { type: "text", value: "reverse prompt" } },
      },
      {
        nodeId: promptNode.id,
        nodeType: promptNode.type,
        name: promptNode.name,
        status: "success",
        attempts: 1,
        outputs: { text: { type: "text", value: "combined prompt" } },
      },
      {
        nodeId: imageNode.id,
        nodeType: imageNode.type,
        name: imageNode.name,
        status: "failed",
        attempts: 2,
        attemptId: "old-attempt",
        startedAt: now - 500,
        finishedAt: now - 100,
        progress: 67,
        inputs: { prompt: { type: "text", value: "combined prompt" } },
        outputs: {},
        upstreamJobs: [
          { taskId: "paid-success", status: "success", progress: 100, images: ["a.png"] },
          { taskId: "failed-job", status: "failed", progress: 42, images: [], error: "upstream failed" },
        ],
        submissionErrors: ["second submit failed"],
        error: "只完成了部分图片",
        errorDetail: "one paid task succeeded",
      },
      {
        nodeId: outputNode.id,
        nodeType: outputNode.type,
        name: outputNode.name,
        status: "blocked",
        attempts: 0,
        outputs: { result: { type: "images", value: ["stale.png"] } },
        error: "上游失败",
      },
    ],
    outputs: { result: { type: "images", value: ["stale.png"] } },
    currentNodeId: imageNode.id,
    stopRequested: true,
    error: "图片生成失败",
    createdAt: now - 800,
    startedAt: now - 700,
    finishedAt: now - 50,
    updatedAt: now - 50,
  };
  const original = structuredClone(run);

  const retried = prepareWorkflowRunForRetry(run);

  assert.deepEqual(run, original, "retry preparation must not mutate the persisted run object");
  assert.deepEqual(retried.steps.slice(0, 3), original.steps.slice(0, 3));
  assert.equal(retried.steps[3].status, "pending");
  assert.equal(retried.steps[3].attempts, 2);
  assert.deepEqual(retried.steps[3].upstreamJobs, [original.steps[3].upstreamJobs?.[0]]);
  assert.deepEqual(retried.steps[3].outputs, { images: { type: "images", value: ["a.png"] } });
  assert.equal(retried.steps[3].attemptId, undefined);
  assert.equal(retried.steps[3].submissionErrors, undefined);
  assert.equal(retried.steps[3].error, undefined);
  assert.equal(retried.steps[4].status, "pending");
  assert.deepEqual(retried.steps[4].outputs, {});
  assert.equal(retried.steps[4].error, undefined);
  assert.equal(retried.status, "queued");
  assert.deepEqual(retried.outputs, {});
  assert.equal(retried.currentNodeId, undefined);
  assert.equal(retried.stopRequested, false);
  assert.equal(retried.error, undefined);
  assert.equal(retried.startedAt, undefined);
  assert.equal(retried.finishedAt, undefined);
});

test("prepareWorkflowRunForRetry can explicitly restart an earlier successful step", () => {
  const now = Date.now();
  const draft = createDefaultWorkflow();
  const workflow = {
    ...draft,
    schemaVersion: 1 as const,
    id: "workflow-explicit-retry",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const run: WorkflowRun = {
    id: "run-explicit-retry",
    workflowId: workflow.id,
    workflowVersion: 1,
    workflowName: workflow.name,
    workflowSnapshot: workflow,
    inputs: {},
    status: "success",
    steps: workflow.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      name: node.name,
      status: "success" as const,
      attempts: 1,
      outputs: { preserved: { type: "text" as const, value: node.name } },
    })),
    outputs: { result: { type: "images", value: ["done.png"] } },
    stopRequested: false,
    createdAt: now,
    updatedAt: now,
  };

  const retried = prepareWorkflowRunForRetry(run, workflow.nodes[1].id);

  assert.equal(retried.steps[0].status, "success");
  assert.deepEqual(retried.steps[0].outputs, run.steps[0].outputs);
  for (const step of retried.steps.slice(1)) {
    assert.equal(step.status, "pending");
    assert.deepEqual(step.outputs, {});
  }
});

test("workflow validation never mutates the draft being checked", () => {
  const draft = createDefaultWorkflow();
  const snapshot = cloneDraft(draft);

  validateWorkflow(draft);

  assert.deepEqual(draft, snapshot);
});
