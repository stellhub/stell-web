## Abstract

For the past two decades, the business logic of internet applications has rested on one core premise: **the marginal delivery cost of software is low enough**. As user scale grows, fixed costs are spread across a larger base. Server, bandwidth, engineering, and operations costs decline as a share of revenue, giving software companies a chance to earn high gross margins and scale profits.

Generative AI is rewriting that premise. A click, query, or refresh in a traditional app is usually a combination of database, cache, search-engine, and business-service calls. But once an AI-enabled app routes a request through a large model, that request becomes real token consumption. Tokens are not an abstraction. Behind them are GPU time, VRAM, memory bandwidth, electricity, cooling, SSDs, networking, and data-center capital expenditure.

This means software companies in the AI era are no longer just companies that write code, buy servers, and expand user bases. In a real sense, they are becoming compute brokers. If they do not redesign product form, cost structure, pricing model, and technical architecture, AI will not reduce cost and improve efficiency. It will drag them into the trap of "more users, larger losses."

My judgment is direct: **the AI applications that survive will not be the ones that simply plug ChatGPT into an app. They will be the companies that turn AI calls into engineering systems that are measurable, compressible, tiered, priceable, and reusable.**

---

## 1. The Profit Logic of Traditional Internet Applications: More Scale, Lower Marginal Cost

The economic model of a traditional internet application can be simplified as:

> fixed R&D cost + infrastructure cost + user acquisition cost = total cost
> after user scale grows, unit user cost declines and the platform enters the scale-return stage.

A typical internet system usually handles a user request through this path:

```text
Client
  -> CDN / Gateway
  -> Application Service
  -> Cache / DB / Search / MQ
  -> Response
```

In this model, most costs show obvious scale amortization.

For example, the engineering cost of building a feature is fixed. Databases, caches, gateways, and search clusters do scale with traffic, but not every request maps to a scarce, high-value resource burn. Cache hits, batching, asynchronous execution, hot/cold tiering, CDN, index optimization, connection pools, and object storage all keep reducing unit request cost.

That is why software companies historically had a strong commercial advantage:

**The more users they had, the lower the unit service cost became.**

This is why SaaS, social platforms, e-commerce, local services, content communities, and productivity tools can reach high gross margins once they cross the cold-start and growth phases.

AI breaks this logic.

---

## 2. The Cost Logic of AI Applications: Every Unit of Intelligence Burns Compute

A large-model call is not an ordinary RPC.

An ordinary business request may consume only milliseconds of CPU time and a small amount of network I/O. A large-model request, especially one involving complex dialogue, long context, agents, multimodal input, code generation, or retrieval-augmented generation, may consume a large number of tokens and GPU inference resources.

Using public API pricing as an example, OpenAI's official pricing page shows that different models charge separately for input, cached input, and output tokens. Models such as gpt-5.5, gpt-5.4, mini, and nano differ greatly in price per million tokens, and output tokens are usually much more expensive than input tokens. ([OpenAI Developers][1])

This reveals a key fact:

**The cost of an AI request is not a "request count" cost. It is a "semantic compute" cost.**

In a traditional system, a query can often be optimized into a cache hit. In an AI system, if the user asks the model to understand, reason, and generate again every time, every request becomes real cost.

Worse, an AI application is often not a single model call. It is a chain of model calls:

```text
User input
  -> Intent recognition model
  -> RAG retrieval
  -> Query rewrite
  -> Main model reasoning
  -> Tool call
  -> Result validation
  -> Second-pass generation
  -> Safety review
  -> Final answer
```

The user may appear to click only one button, while the backend may have already performed three to ten model calls.

This is the first-principles shift in AI applications:

> The core cost of a traditional internet application is service requests.
> The core cost of an AI application is inference tokens.
> Token marginal cost does not naturally fall to zero as user scale grows.

---

## 3. The Paradox of AI Efficiency: Saving Labor While Increasing Inference Cost

Many companies adopt AI to reduce cost and improve efficiency.

Examples include:

```text
Adding AI to customer service to reduce human agents.
Adding AI to office systems to improve employee productivity.
Adding AI to search to improve answer quality.
Adding AI to e-commerce to improve conversion.
Adding AI to developer platforms to improve coding efficiency.
Adding AI to operations systems to generate content automatically.
```

These directions are not wrong.

The mistake is treating AI as a free intelligence plugin rather than a new cost center.

Previously, the main cost of a customer-service system was human support, ticketing software, and knowledge-base maintenance. After adding AI, if every user question directly calls a large model, context keeps growing, output keeps growing, and multiple follow-up turns are needed, the AI bill will expand quickly.

A content community once relied mainly on recommendation algorithms, search, caching, and CDN to carry traffic. After adding AI, if every post summary, comment digest, smart reply, content moderation task, and creation assistant goes through a large model, the cost structure fundamentally changes.

A developer platform previously sold IDEs, code hosting, CI/CD, and artifact repositories. After adding an AI coding assistant, every completion, explanation, refactor, test generation, and code review carries token cost. The more active users are, the higher the cost becomes.

This is the paradox of AI efficiency:

> AI can reduce human cost,
> but it increases machine-intelligence cost.
> If machine-intelligence cost cannot be covered by product value, "cost reduction and efficiency improvement" is a false proposition.

It is especially dangerous when companies give AI features away for free as a growth tactic. This may increase activity in the early stage, but it can become a financial black hole in the medium and long term.

**Free AI most easily creates a bad business with high activity, low revenue, and high losses.**

---

## 4. Self-Hosted Large Models Are Not a Universal Answer: Software Profit Can Be Eaten by Hardware

When many companies see high API costs, they naturally think:

> If I deploy the model myself, will that not save money?

That judgment is only half right.

Self-hosting can reduce some long-term inference cost, especially for companies with stable call volume, clear scenarios, sensitive data, and models that can be trimmed. But self-hosting does not eliminate API cost. It converts cost from pay-per-token spending into capital expenditure, operating expenditure, hardware depreciation, energy, and talent cost.

Companies must face:

```text
GPU purchase cost
GPU cloud rental cost
VRAM and memory cost
High-speed network cost
SSD / NVMe storage cost
Machine room, power, and cooling cost
Model deployment and inference framework cost
Model compression, quantization, and distillation cost
Inference scheduling and elastic scaling cost
Model safety, compliance, and evaluation cost
```

Public material shows that high-end AI GPUs remain very expensive. Some market reports estimate that commercial AI GPUs such as H100, H200, and B200 are usually priced at tens of thousands of dollars per card, while an eight-GPU server may reach hundreds of thousands of dollars. ([IntuitionLabs][2])

At a macro level, AI infrastructure has already become a capital race among giants. Reports have noted that Amazon, Alphabet, Microsoft, Meta, and other large technology companies have reached hundreds of billions of dollars in AI infrastructure capital expenditure, with spending continuing to expand in 2026. ([Financial Times][3])

What does this mean for software companies?

It means the profit distribution chain in the AI era is changing:

```text
Before:
User payment -> software company -> small cloud / server cost -> software company keeps high gross margin

Now:
User payment -> software company -> model API / GPU / cloud vendor / chip / data center -> software company margin is compressed
```

Software companies once captured the code dividend. AI application companies are increasingly forced to capture a compute spread.

The problem is that compute spread is not the natural advantage of ordinary software companies. The parties with real bargaining power are:

```text
Chip vendors
Cloud vendors
Model vendors
Data-center operators
Energy resource owners
Platforms with massive users and cash flow
```

If an ordinary software company merely wraps someone else's large model as its own product, its long-term moat will be very thin.

My view is blunt:

**If a software company's AI capability is only "call a large-model API and build a UI," it is not an AI company. It is a channel partner of the large-model vendor.**

Channel partners can make money, but they rarely gain high valuations, high gross margins, or long-term pricing power.

---

## 5. After AI Adoption, Internet Business Models Shift from User Scale to Unit Economics

Traditional internet companies focus on DAU, MAU, retention, time spent, and conversion rate.

AI internet applications must also track another metric:

```text
AI Gross Margin = AI feature revenue - AI inference cost - AI-related infrastructure cost
```

More specifically, this should be decomposed into:

```text
ARPU
AI requests per user
Average input tokens per request
Average output tokens per request
Model unit price
Cache hit rate
Small-model interception rate
Labor replacement value
Incremental business conversion
```

Whether an AI feature is worth launching should not be judged only by whether users like it. It should be judged by:

```text
Are users willing to pay for it?
Does it improve conversion?
Does it reduce labor cost?
Does it improve retention?
Does it create a data loop?
Does it create an irreplaceable business barrier?
```

If all answers are no, the AI feature is a cost toy.

There are many such features:

```text
Generic AI chat entry points
AI summaries on every page
Smart recommendation copy without a business loop
Low-frequency AI assistants
Long-form generation that users do not pay for
Smart Q&A that cannot improve conversion
```

These features look advanced, but their business value is weak.

The features worth keeping are:

```text
AI that directly improves GMV
AI that directly reduces labor cost
AI that improves expert productivity
AI that creates an industry data barrier
AI that embeds into core workflows
AI that makes users willing to upgrade plans
```

In the AI era, software companies must move from feature thinking to unit-economics thinking.

**Not every feature is worth AI-enabling. Any AI feature that cannot generate revenue, efficiency, retention, conversion, or risk-control value should be cut.**

---

## 6. First Path: AI Tiering Instead of Sending Every Request to the Largest Model

The most mistaken AI architecture sends every request directly to the strongest model.

The correct approach is model tiering.

```text
Rule system
  -> Small model
  -> Medium model
  -> Large model
  -> Expert model
  -> Human fallback
```

Different problems should use different capability levels.

For example:

```text
Simple classification: rules / embeddings / small model
FAQ answers: RAG + small model
Structured extraction: small model / specialized model
Complex reasoning: large model
High-value decisions: large model + human review
```

A mature AI application backend should not look like this:

```text
App -> GPT-5.5 -> Response
```

It should look more like this:

```text
App
  -> AI Gateway
  -> Intent Router
  -> Cache
  -> Prompt Optimizer
  -> Model Router
      -> Rule Engine
      -> Small Model
      -> Medium Model
      -> Large Model
      -> Domain Model
  -> Tool Runtime
  -> Cost Controller
  -> Response
```

The AI Gateway will become important infrastructure for future software companies. It should do more than forward requests. It should handle:

```text
Model routing
Token budget control
Prompt compression
Context trimming
Semantic cache
Result cache
Multi-model degradation
Tenant-level rate limiting
User-level cost accounting
Request auditing
Effect evaluation
A/B testing
Safety filtering
```

In other words, AI applications must not connect nakedly to models.

**Connecting directly to a large model is as immature as letting microservices connect directly and casually to databases.**

---

## 7. Second Path: Move from Prompt Engineering to Context Engineering

Many companies understand AI capability as prompt writing.

That is a shallow understanding.

The real core of an AI application is not the prompt. It is the context.

The prompt is instruction. Context is the business asset.

For example, a user asks:

> Help me analyze whether this customer is worth continued follow-up.

The large model itself does not know who the customer is. It does not know the company's sales stage, contract amount, historical communication, industry attributes, payment risk, competitors, internal resources, or customer decision chain.

The valuable work is organizing this context:

```text
Customer profile
Historical orders
CRM records
Meeting notes
Contract risks
Industry knowledge
Similar customer cases
Sales stage
Internal company rules
```

This is the opportunity for software companies.

Model vendors own general intelligence, but they do not own internal enterprise context.

Software companies should therefore build moats around:

```text
Industry knowledge bases
Business process data
User behavior data
Enterprise private data
Domain rules
Workflow orchestration
Permission systems
Audit systems
Data feedback loops
```

The key question in future AI application competition is not:

> Who writes better prompts?

It is:

> Who can feed business context to models more cheaply, safely, and accurately?

This is why RAG, knowledge graphs, vector retrieval, structured-data fusion, permission-aware retrieval, and context compression will become important.

**Prompts are tactics. Context is an asset. Software companies should not worship prompts. They should build Context Infrastructure.**

---

## 8. Third Path: Embed AI into Business Workflows Instead of Chat Boxes

Many apps currently integrate AI in a crude way:

```text
Add an AI assistant to the lower-right corner.
Add an AI search box to the home page.
Add an AI summary button to a detail page.
Add an AI generation button beside an input field.
```

The problem is that AI remains separate from the business process.

Users still need to decide when to use AI, how to ask AI, and how to move AI results back into the business system.

Valuable AI applications should be embedded into workflows.

In an e-commerce system, AI should not only "help me write product copy." It should enter the whole chain:

```text
Product data collection
  -> Title generation
  -> Selling-point extraction
  -> Image review
  -> Pricing suggestion
  -> Audience matching
  -> Ad copy
  -> Conversion-rate analysis
  -> Automatic iteration
```

In a customer-service system, AI should not only be "smart Q&A." It should enter:

```text
Issue recognition
  -> User identity judgment
  -> Order lookup
  -> Risk identification
  -> Solution generation
  -> Ticket routing
  -> Satisfaction prediction
  -> Human takeover
```

In a developer system, AI should not only be "code chat." It should enter:

```text
Requirement analysis
  -> Technical design
  -> Code generation
  -> Unit tests
  -> Code review
  -> CI failure diagnosis
  -> Performance analysis
  -> Release risk evaluation
```

Only by entering workflows can AI create measurable value.

A standalone AI chat box can feel novel at first, but usage frequency usually falls after the novelty fades. Workflow-embedded AI becomes part of the production system.

**The end state of AI applications is not chatbots. It is business process automation.**

---

## 9. Fourth Path: Move from Free AI to Value-Based Charging

Traditional SaaS pricing commonly uses:

```text
Per-account charging
Plan-based charging
Feature-module charging
Storage-capacity charging
API-call charging
```

In the AI era, these pricing methods need to be rebuilt.

AI cost is not fully linear with user count. It is highly related to usage depth, token length, model tier, generation count, and agent steps.

AI applications are therefore better suited to hybrid pricing:

```text
Base subscription fee
+ AI credit pack
+ Premium model surcharge
+ Long-context surcharge
+ Agent automation task surcharge
+ Enterprise knowledge-base surcharge
+ SLA / private deployment surcharge
```

For enterprise customers, pricing should even be based on business value:

```text
Charge for each customer-service ticket saved.
Charge for each qualified sales lead generated.
Charge for each automated audit completed.
Charge for each contract processed.
Charge for each code migration completed.
```

This is more reasonable than simply marking up tokens.

The reason is that users do not care about tokens. Users care about results.

But companies must account for token cost rigorously inside their own systems.

That means:

```text
Internally: calculate cost by token, model, chain, and tenant.
Externally: charge by business value, plan, result, and efficiency gain.
```

This is where AI product managers and architects must design together.

If pricing ignores token cost completely, the technical team will eventually take the blame. If pricing passes token cost directly to users, the user experience will become worse.

A better approach is:

```text
Free plan: small model + low quota + strict limits
Professional plan: medium model + daily quota
Enterprise plan: large model + private knowledge base + SLA
Flagship plan: agent automation + private deployment + cost audit
```

**AI features must not remain unlimited and free for the long term. Unlimited free AI is essentially a subsidy to the compute industry chain.**

---

## 10. Fifth Path: Build Vertical Domain AI Instead of General Assistants

Competition among general AI assistants is brutal.

General assistants directly face model vendors, phone vendors, operating-system vendors, browser vendors, and office-suite vendors.

Ordinary software companies have little chance of winning on that battlefield.

The better direction for software companies is vertical domains.

Examples include:

```text
AI legal services
AI tax and accounting
AI medical assistance
AI industrial quality inspection
AI operations diagnosis
AI developer productivity
AI customer service
AI education
AI recruiting
AI data analysis
AI supply chain
AI financial risk control
```

Vertical domains have advantages:

```text
Professional knowledge barriers
Industry data barriers
Compliance thresholds
Business process complexity
Customer willingness to pay
Measurable outcomes
```

A general assistant answering "help me write a summary" has low value. A vertical system answering "what payment, breach, and jurisdiction risks are in this contract" has much higher value.

General models can provide the intelligence base, but industry software companies should provide:

```text
Domain data
Domain processes
Domain evaluation
Domain tools
Domain permissions
Domain responsibility boundaries
```

This is the sustainable business model.

**Most future software companies should not build general AI. They should build industry AI. General AI is the battlefield of giants; industry AI is the home field of software companies.**

---

## 11. Sixth Path: Build AI Cost Governance

Companies used to practice FinOps to govern cloud resource cost.

The AI era needs AI FinOps.

Companies must know:

```text
Which users consume the most tokens?
Which features consume the most tokens?
Which prompts cause output inflation?
Which agent chains call models too many times?
Which models have the worst cost-performance ratio?
Which requests can be cached?
Which requests can use small models?
Which scenarios should be downgraded?
Which AI features are not paid for at all?
```

AI cost governance should become an infrastructure capability.

Every AI application should establish metrics such as:

```text
request_count
input_tokens
output_tokens
cached_tokens
cost_per_request
cost_per_user
cost_per_tenant
cost_per_feature
cost_per_successful_task
model_latency
model_error_rate
cache_hit_rate
small_model_route_rate
fallback_rate
human_handoff_rate
```

It should also enforce budget controls:

```text
Daily token limit per user
Daily cost limit per tenant
Maximum context length per request
Maximum execution steps per agent
Maximum model calls per task
Downgrade low-value users to cheaper models
Circuit-break abnormal requests
Open high-cost features through gray release
```

This is very similar to familiar microservice governance.

Previously, we governed:

```text
QPS
RT
Error rate
Rate limiting
Circuit breaking
Degradation
Capacity
```

In the AI era, we must also govern:

```text
TPS: Tokens Per Second
TPR: Tokens Per Request
CPU/GPU Cost Per Task
Model Cost Per Tenant
Prompt Inflation
Context Explosion
Agent Step Explosion
```

The AI Gateway can become the next-generation service governance entry point.

**Whoever masters AI cost governance is qualified to launch AI at scale.**

---

## 12. Seventh Path: Use Small Models, Distillation, Caching, and Edge Models to Reduce Cost

Software companies cannot depend only on the strongest large models.

The technical paths for cost optimization are clear.

### 1. Small Models First

Many tasks do not need the strongest model.

Examples include:

```text
Text classification
Keyword extraction
Intent recognition
Format conversion
Simple summarization
FAQ matching
Sensitive-word detection
Routing decisions
```

These tasks can be handled by small models, rules, embeddings, traditional NLP, or even SQL.

### 2. Semantic Cache

User questions may be worded differently while carrying similar meaning.

For example:

```text
How do I get a refund?
What should I do if I want to return goods?
How do I handle an order I no longer want?
```

These questions can reuse answers through embedding retrieval instead of calling a large model every time.

### 3. Prompt Compression

Many AI applications write extremely wasteful prompts. System prompts, historical context, and knowledge fragments are repeatedly inserted, causing token inflation.

They should use:

```text
Context trimming
History summarization
Knowledge-fragment deduplication
Structured prompts
Short-output constraints
Template reuse
Cached input
```

OpenAI's official pricing also distinguishes cached input, showing that cached input has become an important mechanism in model pricing and cost optimization. ([OpenAI Developers][1])

### 4. Precise RAG Retrieval

RAG is not stuffing a pile of documents into the model. It requires precise retrieval, reranking, filtering, and compression.

Bad RAG increases token cost and reduces answer quality.

### 5. Model Distillation

Distill a large model's capability in a specific domain into a smaller model, and let the small model handle high-frequency tasks.

### 6. Local and Edge Inference

For privacy-sensitive, low-latency, low-complexity tasks, on-device or edge models can be considered.

Examples include:

```text
Input prediction
Local summarization
Simple classification
Image pre-screening
Voice wake-up
Personal knowledge retrieval
```

But on-device models are not a silver bullet. They fit low-cost, high-frequency, privacy-sensitive scenarios, not all complex reasoning.

---

## 13. Eighth Path: Sell Intelligent Outcomes Instead of Software

In the AI era, the value expression of software companies will change.

Previously, users bought software as tools.

For example:

```text
Buy CRM to manage customers.
Buy ERP to manage resources.
Buy Jira to manage projects.
Buy IDEs to write code.
Buy BI to view reports.
```

In the AI era, users are more likely to pay for outcomes.

For example:

```text
Not buying a customer-service system, but buying automatic resolution rate.
Not buying a coding tool, but buying engineering productivity.
Not buying a marketing system, but buying conversion improvement.
Not buying a legal system, but buying contract risk identification.
Not buying a BI system, but buying business insight.
```

This will push software companies from tool companies toward outcome companies.

But outcome companies carry greater responsibility:

```text
Is the result accurate?
Who is responsible for mistakes?
Is it explainable?
Is it auditable?
Is it traceable?
Is it compliant?
Is there human fallback?
```

Future AI software must provide not only generated answers, but also evidence chains.

A mature AI system should output:

```text
Conclusion
Evidence
Cited sources
Confidence
Risk warnings
Executable suggestions
Human review entry
Audit logs
```

This is far more important than merely generating polished text.

**The value of AI software is not that it can talk. It is that it can take responsibility.**

---

## 14. Ninth Path: Build Your Own Data Flywheel Instead of Just Wrapping Models

The greatest danger for software companies is becoming a large-model shell company.

Typical signs of such a company are:

```text
No exclusive data
No deep process
No industry know-how
No customer system integration
No cost governance
No model optimization capability
No reusable assets
```

Such companies can grow briefly because of novelty, but they will be quickly copied by model vendors, platforms, and competitors.

Truly valuable software companies must build a data flywheel:

```text
Users use the product
  -> Business data is generated
  -> AI assists decisions
  -> Users provide outcome feedback
  -> The system evaluates results
  -> Models and rules are optimized
  -> Business performance improves
  -> More users are attracted
```

The most important part of this flywheel is feedback data.

Examples include:

```text
Did the sales pitch recommended by AI close the deal?
Did the code generated by AI pass tests?
Were contract risks identified by AI accepted by legal reviewers?
Did AI customer-service answers solve the problem?
Did AI operations diagnosis locate the root cause?
```

Without feedback, there is no optimization.

Without optimization, there is no moat.

**The core asset of an AI application is not model call logs. It is business feedback data with outcome labels.**

---

## 15. Three Possible Futures for Internet Applications

I believe software companies in the AI era will split into three types.

### Type 1: Applications Crushed by AI Cost

These companies share the following traits:

```text
Blind AI adoption
All requests sent to large models
Free AI features
No cost governance
No business loop
Users unwilling to pay
Model bills keep rising
```

The result is that users appear to grow while financial performance gets worse.

These companies will die quickly.

### Type 2: Plugins and Channels in the Large-Model Ecosystem

These companies have some product capability but lack data and process barriers.

They can make money, but their margins will be compressed by model vendors and cloud vendors.

Typical traits include:

```text
Dependence on a single model provider
Easily copied features
No pricing control
Low customer switching cost
```

These companies can survive, but they will find it hard to become giants.

### Type 3: Industry Intelligence Infrastructure

These companies will win.

They have:

```text
Deep focus on vertical industries
Control over business context
Proprietary data
Embedding into core workflows
AI cost governance
Model routing capability
Feedback loops
Outcome delivery capability
```

They do not simply sell AI. They sell industry intelligence capability.

The most valuable future software companies should look like this:

```text
Industry SaaS
+ AI Gateway
+ Context Infrastructure
+ Domain Model
+ Workflow Automation
+ Cost Governance
+ Data Feedback Loop
```

---

## 16. Strategic Advice for Software Companies

### 1. Do Not Do AI for AI's Sake

Before launching any AI feature, answer:

```text
What high-value problem does it solve?
Is it better than the traditional method?
Can it generate revenue or save cost?
Are users willing to pay for it?
Does the unit economics work?
```

If the answers are unclear, do not launch it.

### 2. Govern Tokens Like Database Connections

Good engineers do not casually open database connections, query without limits, or scan entire tables.

The AI era is the same:

```text
Do not use unlimited context.
Do not allow unlimited output.
Do not allow unlimited agent steps.
Do not send every request to a large model.
Do not operate without budget controls.
```

Tokens are resources, not air.

### 3. Start with High-Value, Low-Frequency, Strong-Payment Scenarios

Do not begin with high-frequency, low-value AI.

Prioritize:

```text
Contract review
Fault diagnosis
Sales lead analysis
Code migration
Financial analysis
Complex customer-service issues
Enterprise knowledge Q&A
```

Users are willing to pay for these scenarios, and they can cover inference cost.

### 4. Build an AI Gateway and Cost Observability System

Companies without an AI Gateway should not AI-enable at scale.

At minimum, they need:

```text
Model routing
Token statistics
User quotas
Tenant cost
Caching
Degradation
Auditing
Evaluation
```

### 5. Build Industry Data, Not Just Prompts

Prompts are not a long-term barrier.

Long-term barriers come from:

```text
Data
Processes
System integration
Industry experience
Feedback loops
Compliance capability
```

### 6. Pricing Must Cover AI Cost

AI features must not remain unlimited and free for the long term.

Free usage can be a trial, but it must be limited by:

```text
Number of uses
Context length
Model tier
Feature scope
Concurrency
```

Enterprise contracts must include AI cost.

### 7. Be Careful with Self-Hosted Models

Self-hosted models fit companies with:

```text
Sufficient call volume
Stable scenarios
High data-security requirements
Model engineering capability
GPU operations capability
Ability to perform model compression and scheduling
```

Otherwise, self-hosting may only turn an API bill into a GPU bill.

---

## 17. Final Judgment: AI Is Not the End of Software, but a Cost Restructuring of Software

AI will not eliminate internet applications.

But AI will eliminate a group of internet applications with the wrong cost structure.

Previously, internet companies competed on:

```text
Traffic
Growth
Recommendation
Supply chain
Organizational efficiency
```

Future AI applications must also compete on:

```text
Compute efficiency
Context engineering
Model routing
Industry data
Cost governance
Outcome delivery
```

The central contradiction for software companies has shifted from:

> How do we get more users?

to:

> How do we make every intelligent call generate enough business value?

This is the new reality internet applications must face in the AI era.

My conclusion is:

**Internet applications should not be blindly AI-enabled. They should be AI-enabled by value. AI should not be treated as a feature, but as a production system. The goal should not be "AI everywhere," but "profit in every AI call."**

The future software companies that survive will be the ones that turn AI from a showy feature into profitable intelligence infrastructure.

Otherwise, the profits software companies work hard to create will ultimately flow to GPUs, cloud vendors, model vendors, and data centers.

[1]: https://developers.openai.com/api/docs/pricing?utm_source=chatgpt.com "Pricing | OpenAI API"
[2]: https://intuitionlabs.ai/articles/nvidia-ai-gpu-pricing-guide?utm_source=chatgpt.com "NVIDIA AI GPU Prices: H100 ($27K-$40K) & H200 ($315 ..."
[3]: https://www.ft.com/content/b3dfaba9-17a2-4fac-90fe-4ab3ca7c9494?utm_source=chatgpt.com "Big Tech's $725bn AI spending spree sends free cash flow to a decade low"
