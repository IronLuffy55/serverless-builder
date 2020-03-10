#!/usr/bin/env node
//#region requires
const {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync
} = require("fs");
const { join, basename } = require("path");
const mustache = require("mustache");
const rimraf = require("rimraf");
const Yaml = require("yaml");
//#endregion
const prepend = "";
const { serverlessBuilder = {} } = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"))
);
const basePath = serverlessBuilder.basePath || join(process.cwd(), "base.yml");
const outputPath =
  serverlessBuilder.outputPath || join(process.cwd(), "serverless.yml");
const templatesPath =
  serverlessBuilder.templatesPath || join(__dirname, "templates");
const mappingTemplatesPath = join(process.cwd(), "mapping-templates");
const handlersPath =
  serverlessBuilder.handlersPath || join(process.cwd(), "handlers.js");
const wrapperBasePath =
  serverlessBuilder.wrapperBasePath ||
  existsSync(join(process.cwd(), "wrapper_base.js"))
    ? join(process.cwd(), "wrapper_base.js")
    : join(__dirname, "templates", "wrapper_base.js");

const baseFileName = basename(handlersPath, ".js");

if (existsSync(mappingTemplatesPath)) rimraf.sync(mappingTemplatesPath);
const text = readFileSync(handlersPath, { encoding: "UTF8" });
const lines = text.split("\n");
const base = readFileSync(basePath, { encoding: "UTF8" });
const baseObj = Yaml.parse(base);
const wrapperBase = readFileSync(wrapperBasePath, { encoding: "UTF8" });
//Walk lines ot get the gql and first line following
const pairs = lines.reduce((out, thisLine) => {
  if (thisLine.includes("@lambda")) {
    return [...out, [thisLine]];
  } else if (out.length && out[out.length - 1].length === 1) {
    const last = out.pop();
    last.push(thisLine);
    return [...out, last];
  } else return out;
}, []);
const pairInfo = pairs.reduce((out, thisPair) => {
  const functionName = thisPair[1].split(" ")[1];
  let functionInfo = thisPair[0]
    .split(" ")
    .filter(item => !["//@lambda"].includes(item))
    .reduce(
      (out, thisHeader) => {
        if (thisHeader.includes("=")) {
          const [key, value] = thisHeader.split("=", 2);
          return { ...out, [key]: value };
        } else return { ...out, [thisHeader]: true };
      },
      { functionName }
    );
  if (typeof functionInfo.isBatch === "undefined")
    functionInfo.isBatch =
      thisPair[1].includes("withBatch(") ||
      (!["Query", "Mutation"].includes(out.type) &&
        functionInfo.functionName.includes("For"));
  if (typeof functionInfo.type === "undefined")
    functionInfo.type = functionName.startsWith("get") ? "Query" : "Mutation";
  if (typeof functionInfo.field === "undefined")
    functionInfo.field = functionName;
  return { ...out, [functionName]: functionInfo };
}, {});
//Are there any gqls?
if (Object.values(pairInfo).find(({ gql }) => gql)) {
  // console.log(mappingTemplates);
  mkdirSync(mappingTemplatesPath);
  [
    "default-batch-result-mapping-template.txt",
    "default-result-mapping-template.txt"
  ].map(thisFile =>
    copyFileSync(
      join(templatesPath, thisFile),
      join(mappingTemplatesPath, thisFile)
    )
  );
}
const capitalize = string => string.charAt(0).toUpperCase() + string.slice(1);
const makeBatchMappingTemplate = (functionName, isBatch) => {
  const source = readFileSync(
    join(
      templatesPath,
      isBatch
        ? "batch-request-mapping-template.txt"
        : "request-mapping-template.txt"
    ),
    { encoding: "UTF8" }
  );
  const out = mustache.render(source, { functionName });
  const mtPath = join(process.cwd(), "mapping-templates");
  if (!existsSync(mtPath)) mkdirSync(mtPath);
  writeFileSync(join(mtPath, `${functionName}-request.txt`), out);
};
const {
  functions,
  mappingTemplates,
  aliases,
  exporteds,
  wrappers,
  gqlparts,
  funcs
} = Object.entries(pairInfo).reduce(
  (
    {
      functions,
      mappingTemplates,
      aliases,
      exporteds,
      wrappers,
      gqlparts,
      funcs
    },
    [
      functionName,
      {
        isBatch,
        type,
        field,
        gql,
        s3,
        expiration,
        dynamodb,
        batchSize,
        sqs,
        role,
        memorySize,
        layers,
        onError,
        awsKmsKeyArn,
        tracing,
        runtime,
        timeout,
        reservedConcurrency,
        name,
        description,
        versionFunctions,
        http,
        method,
        cors,
        schedule,
        rate,
        cloudwatchLog,
        private,
        ...rest
      }
    ]
  ) => {
    const capitalizedFunctionName = capitalize(functionName);
    const prependedName = prepend + capitalizedFunctionName;
    //Make function text
    const o = !gql && {
      handler: `${baseFileName}_wrapper.${functionName}`,
      role: role || { "Fn::GetAtt": ["MainRole", "Arn"] }
    };
    if (memorySize) o.memorySize = memorySize;
    if (layers) o.layers = layers.split(",");
    if (onError) o.onError = onError;
    if (awsKmsKeyArn) o.awsKmsKeyArn = awsKmsKeyArn;
    if (tracing) o.tracing = tracing;
    if (timeout) o.timeout = timeout;
    if (versionFunctions) o.versionFunctions = versionFunctions;
    if (reservedConcurrency) o.reservedConcurrency = reservedConcurrency;
    if (runtime) o.runtime = runtime;
    if (name) o.name = name;
    if (description) o.description = description;
    const tags = Object.entries(rest)
      .filter(([k, v]) => k.indexOf("tag-") === 0)
      .map(([k, v]) => [k.substring(4), v]);
    if (tags.length)
      o.tags = tags.reduce((o, [k, v]) => ({ ...o, [k]: v }), {});
    const envs = Object.entries(rest)
      .filter(([k, v]) => k.indexOf("environment-") === 0)
      .map(([k, v]) => [k.substring("environment-".length), v]);
    if (envs.length)
      o.environment = envsa.reduce((o, [k, v]) => ({ ...o, [k]: v }), {});
    if (
      [s3, sqs, dynamodb, http, schedule, rate, cloudwatchLog].find(Boolean)
    ) {
      o.events = {};
      if (s3) o.events["s3"] = s3.split(",");

      if (dynamodb)
        o.events["stream"] = { type: "dynamodb", batchSize, arn: dynamodb };
      if (sqs) o.events["sqs"] = sqs.split(",");
      if (http)
        o.events["http"] = {
          path: http,
          method: method ? method : "post",
          cors:
            typeof cors !== "undefined" ? (cors ? "true" : "false") : "true",
          private:
            private !== "undefined" ? (private ? "true" : "false") : "false"
        };
      if (rate) o.events["rate"] = `rate(${rate} minute)`;
      if (cloudwatchLog) o.events["cloudwatchLog"] = cloudwatchLog.split(",");
    }
    if (o) functions[prependedName] = o;
    //Make resolver text

    const mappingTemplate = gql && {
      dataSource: "lambdaAppSyncResolver",
      type,
      field,
      request: `${functionName}-request.txt`,
      response: isBatch
        ? "default-batch-response-mapping-template.txt"
        : "default-response-mapping-template.txt"
    };
    if (gql) makeBatchMappingTemplate(functionName, isBatch);

    const thisExport = !gql && functionName;

    const wrapper =
      !gql && `const ${functionName} = withWrapper(${functionName}_old);`;
    let gqlpart = gql && `case "${functionName}": return ${functionName}_old`;
    return {
      wrappers: [...wrappers, wrapper].filter(Boolean),
      functions,
      mappingTemplates: [...mappingTemplates, mappingTemplate].filter(Boolean),
      aliases: [...aliases, `${functionName} as ${functionName}_old`].filter(
        Boolean
      ),
      exporteds: [...exporteds, thisExport].filter(Boolean),
      gqlparts: [...gqlparts, gqlpart].filter(Boolean),
      funcs: [...funcs, functionName].filter(Boolean)
    };
  },
  {
    functions: {},
    mappingTemplates: [],
    wrappers: [],
    aliases: [],
    exporteds: [],
    gqlparts: [],
    funcs: []
  }
);

if (gqlparts.length) {
  baseObj.custom.appSync.dataSources = [
    ...(baseObj.custom.appSync.dataSources || []),
    {
      name: "lambdaAppSyncResolver",
      type: "AWS_LAMBDA",
      config: {
        serviceRoleArn: { "Fn::GetAtt": ["MainRole", "Arn"] },
        lambdaFunctionArn: {
          "Fn::GetAtt": ["AppSyncResolverLambdaFunction", "Arn"]
        }
      }
    }
  ];
  baseObj.custom.appSync.mappingTemplates = [
    ...(baseObj.mappingTemplates || []),
    ...mappingTemplates
  ];
}
const wrapperText = mustache.render(wrapperBase, {
  aliases: aliases.join(","),
  wrappers: wrappers.join("\n"),
  exporteds: exporteds.length ? "," + [exporteds].join("\n") : null,
  handlersPath,
  resolvers: gqlparts && gqlparts.join("\n")
});
writeFileSync(join(process.cwd(), baseFileName + "_wrapper.js"), wrapperText);
baseObj.functions = { ...(baseObj.functions || {}), ...functions };
if (gqlparts.length) {
  baseObj.functions.appSyncResolver = {
    handler: `${baseFileName}_wrapper.appSyncResolver`,
    role: { "Fn::GetAtt": ["MainRole", "Arn"] },
    warmup: { enabled: "true" }
  };
}
console.log(JSON.stringify(baseObj, null, 2));
const output = Yaml.stringify(baseObj);
writeFileSync(outputPath, output);
console.log("Recommended handler.js exports:");
process.stdout.write(funcs.join(",\n"));
console.log("\n\nDONE");
