# Splitting Patterns — Worked Examples

Each pattern below includes the trigger question and a worked example.

---

## Pattern 1: Workflow Steps

**Ask:** Does this story contain multiple sequential steps?

**Example:**
- Original: "As a user, I want to sign up, verify my email, and complete onboarding"
- Split:
  1. "As a user, I want to sign up with email/password"
  2. "As a user, I want to verify my email via a confirmation link"
  3. "As a user, I want to complete onboarding by answering 3 profile questions"

---

## Pattern 2: Business Rule Variations

**Ask:** Does this story have different rules for different scenarios?

**Example:**
- Original: "As a user, I want to apply discounts (10% for members, 20% for VIPs, 5% for first-time buyers)"
- Split:
  1. "As a member, I want to apply a 10% discount at checkout"
  2. "As a VIP, I want to apply a 20% discount at checkout"
  3. "As a first-time buyer, I want to apply a 5% discount at checkout"

---

## Pattern 3: Data Variations

**Ask:** Does this story handle different types of data or inputs?

**Example:**
- Original: "As a user, I want to upload files (images, PDFs, videos)"
- Split:
  1. "As a user, I want to upload image files (JPG, PNG)"
  2. "As a user, I want to upload PDF documents"
  3. "As a user, I want to upload video files (MP4, MOV)"

---

## Pattern 4: Acceptance Criteria Complexity

**Ask:** Does this story have multiple "When" or "Then" statements?

**Example:**
- Original: "As a user, I want to manage my cart"
  - When I add an item, Then it appears in my cart
  - When I remove an item, Then it disappears from my cart
  - When I update quantity, Then the cart total updates
- Split:
  1. "As a user, I want to add items to my cart so I can purchase them later"
  2. "As a user, I want to remove items from my cart so I can change my mind"
  3. "As a user, I want to update item quantities so I can buy the right amount"

**Note:** This is the most common indicator that a story needs splitting. If you see multiple "When/Then" pairs, split along those boundaries.

---

## Pattern 5: Major Effort

**Ask:** Does this story require significant technical work that can be delivered incrementally?

**Example:**
- Original: "As a user, I want real-time collaboration on documents"
- Split:
  1. "As a user, I want to see who else is viewing the document (read-only presence)"
  2. "As a user, I want to see live cursor positions of other editors"
  3. "As a user, I want to see live edits from other users in real-time"

---

## Pattern 6: External Dependencies

**Ask:** Does this story depend on multiple external systems or APIs?

**Example:**
- Original: "As a user, I want to log in with Google, Facebook, or Twitter"
- Split:
  1. "As a user, I want to log in with Google OAuth"
  2. "As a user, I want to log in with Facebook OAuth"
  3. "As a user, I want to log in with Twitter OAuth"

---

## Pattern 7: DevOps Steps

**Ask:** Does this story require complex deployment, infrastructure, or operational work?

**Example:**
- Original: "As a user, I want to upload large files to cloud storage"
- Split:
  1. "As a user, I want to upload small files (<10MB) to cloud storage"
  2. "As a user, I want to upload large files (10MB-1GB) with progress tracking"
  3. "As a user, I want to resume interrupted uploads"

---

## Pattern 8: Tiny Acts of Discovery (TADs)

**Ask:** If none of the above apply, are there unknowns or assumptions that need unpacking?

**Example:**
- Original: "As a user, I want AI-powered recommendations" (too vague, too many unknowns)
- TADs:
  1. Prototype 3 recommendation algorithms and test with 10 users
  2. Define success criteria (click-through rate, user satisfaction)
  3. Build the simplest recommendation engine (collaborative filtering)
  4. Measure and iterate

**Note:** TADs aren't stories—they're experiments. Use them to de-risk and clarify before writing stories.
