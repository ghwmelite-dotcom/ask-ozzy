-- eClassroom Sample Lessons Batch
-- 9 lessons: 5 JHS (BECE) + 4 SHS (WASSCE)
-- Do NOT run this file before eclassroom-foundation.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. JHS Math: Addition of Fractions
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'jhs-math-fractions-01',
  'abena',
  'mathematics',
  'jhs',
  'Addition of Fractions',
  '[
    {
      "step": 1,
      "voice_script": "Good morning everyone! Today we are learning how to add fractions. Fractions are everywhere in our daily life. When Mama cuts a loaf of bread into equal pieces, she is working with fractions. Let me draw this on the board.",
      "board_actions": [
        { "action": "addLabel", "text": "Adding Fractions", "position": [80, 25], "color": "#FCD116", "delay_ms": 1000 },
        { "action": "drawShape", "type": "triangle", "points": [[30,80],[170,80],[170,80]], "delay_ms": 0 },
        { "action": "drawLine", "points": [[30,80],[170,80]], "delay_ms": 1500 },
        { "action": "addLabel", "text": "1/4 of bread", "position": [30, 65], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "2/4 of bread", "position": [100, 65], "color": "#4FC3F7", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "When fractions have the SAME denominator, adding is simple. You just add the top numbers — the numerators — and keep the bottom number. For example, one-quarter plus two-quarters. Look at this.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Same denominators:", "position": [30, 30], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "1/4 + 2/4", "position": [30, 60], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= (1+2)/4", "position": [30, 90], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "= 3/4", "position": [30, 120], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "But what if the denominators are DIFFERENT? Like one-half plus one-third? Here we must find the Lowest Common Denominator — the LCM. Think of it as finding a common meeting point, like choosing a chop bar that is convenient for everyone.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Different denominators:", "position": [25, 25], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "1/2 + 1/3", "position": [30, 55], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "LCM of 2 and 3 = 6", "position": [30, 90], "color": "#4FC3F7", "delay_ms": 1800 },
        { "action": "addLabel", "text": "1/2 = 3/6", "position": [30, 120], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "1/3 = 2/6", "position": [30, 150], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Once both fractions share the same denominator, we add the numerators just as before. Three-sixths plus two-sixths equals five-sixths. This is the answer! Now try this question.",
      "board_actions": [
        { "action": "addLabel", "text": "3/6 + 2/6", "position": [30, 185], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= 5/6", "position": [30, 215], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": {
        "type": "mcq",
        "question": "What is 1/3 + 1/6?",
        "correct_answer": "1/2",
        "options": ["2/9", "1/2", "2/3", "1/3"],
        "hint": "Find the LCM of 3 and 6, then convert both fractions before adding.",
        "xp_reward": 50
      }
    }
  ]',
  12,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. JHS Math: Percentages & Discounts
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'jhs-math-percentages-01',
  'abena',
  'mathematics',
  'jhs',
  'Percentages and Discounts',
  '[
    {
      "step": 1,
      "voice_script": "Akwaaba class! Today we tackle percentages. You see percentage signs every day — at Accra Mall, Kejetia Market, in your maths textbook. Percent simply means out of one hundred. The word comes from Latin: per centum — per hundred.",
      "board_actions": [
        { "action": "addLabel", "text": "Percent = Per 100", "position": [65, 30], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "50% = 50/100 = 0.5", "position": [40, 70], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "25% = 25/100 = 0.25", "position": [40, 100], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "To find a percentage of an amount, multiply the amount by the percentage, then divide by 100. Suppose Kofi buys a bag of rice for 200 Ghana cedis and the seller gives him a 10 percent discount. How much does he save? 10 percent of 200 cedis.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "10% of GHS 200", "position": [60, 30], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= (10/100) x 200", "position": [45, 65], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "= 0.10 x 200", "position": [50, 95], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= GHS 20 saved!", "position": [55, 130], "color": "#81C784", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "Now the discounted price is the original price minus the discount amount. So Kofi pays 200 minus 20, which equals 180 Ghana cedis. This is how traders at Makola Market calculate sale prices every day.",
      "board_actions": [
        { "action": "addLabel", "text": "Discounted Price:", "position": [55, 170], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "200 - 20 = GHS 180", "position": [45, 200], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Let me also show you how to express one number as a percentage of another. If Ama scores 36 out of 50 in a test, what is her percentage score? Divide 36 by 50, then multiply by 100. Let us work it out together.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Score: 36 out of 50", "position": [45, 30], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= (36 / 50) x 100", "position": [45, 65], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "= 0.72 x 100", "position": [50, 95], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= 72%", "position": [80, 130], "color": "#FCD116", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Excellent! Now your turn. A shirt originally costs 150 Ghana cedis. A shop at Accra Mall offers a 20 percent discount. What is the discounted price? Type your answer in cedis.",
      "board_actions": [],
      "checkpoint": {
        "type": "text_input",
        "question": "A shirt costs GHS 150. A 20% discount is applied. What is the discounted price?",
        "correct_answer": "GHS 120",
        "accept_variations": ["120", "120 cedis", "GHS120", "gh 120", "ghs 120", "one hundred and twenty"],
        "hint": "First find 20% of 150, then subtract from 150.",
        "xp_reward": 50
      }
    }
  ]',
  14,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JHS Science: Photosynthesis
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'jhs-sci-photosynthesis-01',
  'kwame',
  'science',
  'jhs',
  'Photosynthesis',
  '[
    {
      "step": 1,
      "voice_script": "Good day scientists! Have you ever wondered how the cocoa tree in your village, or the neem tree in your compound, makes its own food? Today we discover the answer — photosynthesis! This is one of the most important processes on Earth.",
      "board_actions": [
        { "action": "addLabel", "text": "PHOTOSYNTHESIS", "position": [60, 25], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "How plants make food", "position": [55, 55], "color": "#4FC3F7", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "Plants need three things to make food: sunlight, water from the soil, and carbon dioxide from the air. The green pigment inside leaves — chlorophyll — traps the energy from sunlight. In Ghana, our plants are very fortunate because we get plenty of sunshine!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "INPUTS:", "position": [30, 30], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Sunlight (from the sun)", "position": [30, 60], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Water (from roots/soil)", "position": [30, 90], "color": "#4FC3F7", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Carbon dioxide (CO2)", "position": [30, 120], "color": "#81C784", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "The chlorophyll uses sunlight energy to combine water and carbon dioxide and produce two outputs: glucose — which is the plant''s food — and oxygen, which is released into the air. That oxygen is what we breathe! So trees are keeping us alive.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "OUTPUTS:", "position": [30, 30], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Glucose (plant food)", "position": [30, 65], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Oxygen (O2) — we breathe this!", "position": [30, 100], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Here is the word equation summarising photosynthesis. Carbon dioxide plus water, in the presence of sunlight and chlorophyll, produces glucose plus oxygen. Memorise this — it will come in your BECE exam!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "CO2 + H2O", "position": [30, 40], "color": "#4FC3F7", "delay_ms": 1200 },
        { "action": "addLabel", "text": "+ Sunlight + Chlorophyll", "position": [30, 70], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "drawLine", "points": [[30,90],[250,90]], "delay_ms": 1000 },
        { "action": "addLabel", "text": "Glucose + O2", "position": [70, 110], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Excellent work! Let us check what you have learned. Answer this question carefully.",
      "board_actions": [],
      "checkpoint": {
        "type": "mcq",
        "question": "Which part of the plant traps sunlight energy for photosynthesis?",
        "correct_answer": "Chlorophyll",
        "options": ["The roots", "Chlorophyll", "The stem", "The flower"],
        "hint": "Think about what makes leaves green.",
        "xp_reward": 50
      }
    }
  ]',
  15,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. JHS English: Reading Comprehension Skills
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'jhs-eng-comprehension-01',
  'esi',
  'english',
  'jhs',
  'Reading Comprehension Skills',
  '[
    {
      "step": 1,
      "voice_script": "Welcome, dear students! Today we are going to sharpen your reading comprehension skills — one of the most important skills you will ever develop. Whether you are reading a newspaper, a letter from a relative, or your BECE exam paper, comprehension is your key to understanding.",
      "board_actions": [
        { "action": "addLabel", "text": "Reading Comprehension", "position": [45, 25], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= Understanding what you read", "position": [25, 55], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "The first strategy is: READ THE PASSAGE TWICE. The first time, read quickly for the general idea — what is this passage about? The second time, read slowly and carefully. Look for key words, names, dates, and repeated ideas. This is just like when you listen to a story at your grandmother''s house — the second time you hear it, you notice more details.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Strategy 1: Read Twice", "position": [55, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "1st read: Get the main idea", "position": [30, 60], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "2nd read: Find details", "position": [30, 90], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "Strategy two: ANSWER USING THE PASSAGE. Many students make the mistake of writing what they already know from their own experience. But comprehension questions must be answered using ONLY information from the passage. Underline key sentences as you read — they often contain the answers.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Strategy 2: Use the passage", "position": [45, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "DO: Quote or paraphrase", "position": [30, 60], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "DO NOT: Use outside knowledge", "position": [30, 90], "color": "#CF6679", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Strategy three: LOOK FOR THE MAIN IDEA. Every passage has a main idea — what the writer is mostly talking about. It is usually in the first paragraph, sometimes in the last. Ask yourself: if I had to tell a friend what this passage is about in ONE sentence, what would I say? That sentence is your main idea. Now let me test you!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Strategy 3: Find the main idea", "position": [40, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Usually in paragraph 1 or last", "position": [30, 60], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "One sentence summary = main idea", "position": [25, 90], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": {
        "type": "text_input",
        "question": "In your own words, what is one strategy to use when answering comprehension questions?",
        "correct_answer": "Read the passage twice",
        "accept_variations": [
          "read twice",
          "read the passage more than once",
          "use the passage to answer",
          "find the main idea",
          "underline key words",
          "quote from the passage"
        ],
        "hint": "We covered three strategies in this lesson. Name any one of them.",
        "xp_reward": 50
      }
    }
  ]',
  12,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. JHS Social Studies: Ghana's 1992 Constitution Basics
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'jhs-soc-constitution-01',
  'mensah',
  'social_studies',
  'jhs',
  'Ghana''s 1992 Constitution Basics',
  '[
    {
      "step": 1,
      "voice_script": "Good morning, future citizens! Today we are studying one of the most important documents in our country — the 1992 Constitution of Ghana. The constitution is the supreme law of the land. It is above every other law, above every person, including the President. No law in Ghana can contradict the constitution.",
      "board_actions": [
        { "action": "addLabel", "text": "Ghana 1992 Constitution", "position": [45, 25], "color": "#006B3F", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= Supreme Law of Ghana", "position": [55, 55], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "Ghana returned to constitutional rule on 7th January 1993, when the Fourth Republic was inaugurated under President Jerry John Rawlings. The constitution was adopted in April 1992 through a national referendum — meaning Ghanaian citizens voted YES or NO on whether to accept it. About 92 percent voted YES.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Key Dates:", "position": [30, 30], "color": "#EF9F27", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Apr 1992 - Referendum held", "position": [30, 65], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "7 Jan 1993 - 4th Republic begins", "position": [30, 95], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "~92% voted YES", "position": [30, 125], "color": "#FCD116", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "The constitution divides government power into THREE arms. The Executive — led by the President, who runs the country. The Legislature — Parliament, which makes laws. And the Judiciary — the courts, which interpret the laws. This separation of powers prevents any one person or group from having too much control.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "3 Arms of Government:", "position": [50, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "1. Executive (President)", "position": [30, 60], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "2. Legislature (Parliament)", "position": [30, 90], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "3. Judiciary (Courts)", "position": [30, 120], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "The constitution also guarantees the fundamental human rights of every Ghanaian. This includes the right to life, freedom of speech, freedom of religion, and the right to education. These rights are in Chapter Five of the constitution and cannot be taken away from you.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Chapter 5 - Fundamental Rights:", "position": [30, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Right to life", "position": [30, 60], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Freedom of speech", "position": [30, 85], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Freedom of religion", "position": [30, 110], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Right to education", "position": [30, 135], "color": "#81C784", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Well done! Let us see how much you have learned about our constitution.",
      "board_actions": [],
      "checkpoint": {
        "type": "mcq",
        "question": "Which arm of government is responsible for making laws in Ghana?",
        "correct_answer": "Legislature (Parliament)",
        "options": ["The Executive (President)", "Legislature (Parliament)", "The Judiciary (Courts)", "The Electoral Commission"],
        "hint": "Think about which arm was described as making laws, not enforcing or interpreting them.",
        "xp_reward": 50
      }
    }
  ]',
  15,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SHS Math: Solving Quadratic Equations
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-math-quadratic-01',
  'abena',
  'core_mathematics',
  'shs',
  'Solving Quadratic Equations',
  '[
    {
      "step": 1,
      "voice_script": "Welcome back, class! Today we are solving quadratic equations — a very common topic in your WASSCE Core Mathematics paper. A quadratic equation is any equation where the highest power of x is 2. Think of it as a square — just as a square plot of land has area x squared.",
      "board_actions": [
        { "action": "addLabel", "text": "Quadratic Equation", "position": [65, 25], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Form: ax^2 + bx + c = 0", "position": [40, 60], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Example: x^2 - 5x + 6 = 0", "position": [35, 95], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "The first method is factorisation. For the equation x squared minus 5x plus 6 equals zero, we look for two numbers that MULTIPLY to give +6 and ADD to give -5. Let us think... negative 2 and negative 3: they multiply to +6 and add to -5. Perfect!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Method 1: Factorisation", "position": [55, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "x^2 - 5x + 6 = 0", "position": [50, 60], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Find: multiply = +6, add = -5", "position": [30, 90], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "-2 x -3 = +6 ✓", "position": [30, 120], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "-2 + -3 = -5 ✓", "position": [30, 150], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "Now we write the equation in factored form: x minus 2, times x minus 3, equals zero. When a product equals zero, at least one factor must be zero. So either x minus 2 equals zero, giving x equals 2; or x minus 3 equals zero, giving x equals 3. These are the two solutions!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "(x - 2)(x - 3) = 0", "position": [50, 40], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "drawLine", "points": [[30,65],[270,65]], "delay_ms": 800 },
        { "action": "addLabel", "text": "x - 2 = 0  or  x - 3 = 0", "position": [35, 85], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "x = 2  or  x = 3", "position": [75, 120], "color": "#81C784", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "When factorisation is difficult, we use the QUADRATIC FORMULA. This formula works for EVERY quadratic equation. x equals negative b, plus or minus the square root of b squared minus 4ac, all over 2a. Write this down — it is provided in WASSCE exams but you must know how to use it.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Quadratic Formula:", "position": [60, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "x = -b ± √(b²-4ac)", "position": [50, 65], "color": "#FCD116", "delay_ms": 1800 },
        { "action": "drawLine", "points": [[40,90],[240,90]], "delay_ms": 800 },
        { "action": "addLabel", "text": "           2a", "position": [90, 105], "color": "#FCD116", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Let us apply the formula to x squared plus 2x minus 3 equals zero. Here a equals 1, b equals 2, c equals negative 3. The discriminant — b squared minus 4ac — is 4 plus 12, which is 16. The square root of 16 is 4. So x equals negative 2 plus or minus 4, over 2.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "x^2 + 2x - 3 = 0", "position": [55, 25], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "a=1, b=2, c=-3", "position": [65, 55], "color": "#4FC3F7", "delay_ms": 1200 },
        { "action": "addLabel", "text": "b^2 - 4ac = 4+12 = 16", "position": [40, 90], "color": "#EF9F27", "delay_ms": 1500 },
        { "action": "addLabel", "text": "x = (-2 ± 4) / 2", "position": [55, 125], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "x = 1  or  x = -3", "position": [65, 160], "color": "#81C784", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 6,
      "voice_script": "Brilliant! Now it is your turn to solve a quadratic equation. Use any method you prefer — factorisation or the formula. Show your working and write both solutions.",
      "board_actions": [],
      "checkpoint": {
        "type": "text_input",
        "question": "Solve: x² - 7x + 12 = 0. Write both values of x.",
        "correct_answer": "x = 3 or x = 4",
        "accept_variations": [
          "x=3 or x=4",
          "x = 3 and x = 4",
          "3 and 4",
          "3 or 4",
          "x=4 or x=3",
          "x = 4 and x = 3",
          "4 and 3"
        ],
        "hint": "Factorise: find two numbers that multiply to +12 and add to -7.",
        "xp_reward": 50
      }
    }
  ]',
  20,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SHS Math: Simultaneous Equations
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-math-simultaneous-01',
  'abena',
  'core_mathematics',
  'shs',
  'Simultaneous Equations',
  '[
    {
      "step": 1,
      "voice_script": "Hello class! Today we are solving simultaneous equations. Imagine you go to a chop bar and you buy 2 plates of rice and 1 cup of soup for 20 cedis. Your friend buys 1 plate of rice and 2 cups of soup for 16 cedis. How much does each item cost separately? That is exactly the kind of problem simultaneous equations solve!",
      "board_actions": [
        { "action": "addLabel", "text": "Simultaneous Equations", "position": [45, 25], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "2 unknowns, 2 equations", "position": [50, 55], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Solve both at the same time", "position": [40, 85], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "We label the unknowns. Let r equal the price of one plate of rice, and s equal the price of one cup of soup. From the information: 2r plus s equals 20, and r plus 2s equals 16. These are our two equations. Write them down.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Let r = rice, s = soup", "position": [40, 30], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Eq1: 2r + s = 20  ...(i)", "position": [30, 70], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Eq2: r + 2s = 16  ...(ii)", "position": [30, 100], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "We use the elimination method. Multiply equation two by 2: 2r plus 4s equals 32. Now subtract equation one from this: 2r plus 4s minus 2r plus s equals 32 minus 20. The 2r terms cancel! We get 3s equals 12, so s equals 4 Ghana cedis.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Elimination Method:", "position": [60, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "2x (ii): 2r + 4s = 32", "position": [30, 60], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Subtract (i): 3s = 12", "position": [30, 90], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "s = 4  (soup = GHS 4)", "position": [30, 125], "color": "#81C784", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Now substitute s equals 4 back into equation one. 2r plus 4 equals 20, so 2r equals 16, therefore r equals 8. One plate of rice costs 8 Ghana cedis and one cup of soup costs 4 cedis. Let us verify: 2 times 8 plus 4 equals 20. Correct! And 8 plus 2 times 4 equals 16. Correct!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Substitute s=4 into (i):", "position": [40, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "2r + 4 = 20", "position": [50, 60], "color": "#FFFFFF", "delay_ms": 1200 },
        { "action": "addLabel", "text": "2r = 16  →  r = 8", "position": [50, 90], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "drawLine", "points": [[30,115],[270,115]], "delay_ms": 800 },
        { "action": "addLabel", "text": "Rice = GHS 8, Soup = GHS 4", "position": [35, 130], "color": "#81C784", "delay_ms": 1800 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Fantastic! Now answer this checkpoint to earn your XP.",
      "board_actions": [],
      "checkpoint": {
        "type": "mcq",
        "question": "Solve: x + y = 10 and x - y = 4. What is the value of x?",
        "correct_answer": "7",
        "options": ["3", "5", "7", "6"],
        "hint": "Add the two equations together to eliminate y first.",
        "xp_reward": 50
      }
    }
  ]',
  16,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SHS Science: The Periodic Table
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-sci-periodic-01',
  'kwame',
  'science',
  'shs',
  'The Periodic Table',
  '[
    {
      "step": 1,
      "voice_script": "Good day future scientists! Today we explore one of the most powerful tools in all of chemistry — the Periodic Table of Elements. Every material in Ghana — the gold we mine at Obuasi, the bauxite at Awaso, the iron ore at Shiene — is made of elements listed in this table.",
      "board_actions": [
        { "action": "addLabel", "text": "The Periodic Table", "position": [70, 25], "color": "#FCD116", "delay_ms": 1200 },
        { "action": "addLabel", "text": "118 known elements", "position": [75, 55], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Arranged by atomic number", "position": [45, 85], "color": "#81C784", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "The periodic table is arranged in PERIODS — horizontal rows — and GROUPS — vertical columns. As you move across a period, the atomic number increases by one each time. The period number tells you how many electron shells an atom of that element has. For example, all elements in Period 3 have 3 electron shells.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Periods = horizontal rows", "position": [40, 30], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "drawLine", "points": [[30,55],[270,55]], "delay_ms": 1200 },
        { "action": "addLabel", "text": "← Period 2 →", "position": [100, 40], "color": "#4FC3F7", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Groups = vertical columns", "position": [40, 90], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "drawLine", "points": [[80,105],[80,250]], "delay_ms": 1200 },
        { "action": "addLabel", "text": "Group 1", "position": [55, 260], "color": "#81C784", "delay_ms": 1000 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "Group 1 elements are called the Alkali Metals — sodium, potassium, lithium and others. They all have one electron in their outer shell and are very reactive. Group 7 are the Halogens — fluorine, chlorine, bromine — they have 7 outer electrons and also react strongly. Group 0 or 18, the Noble Gases, are completely unreactive — they have full outer shells.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Key Groups:", "position": [30, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Group 1: Alkali Metals (1 e-)", "position": [30, 60], "color": "#CF6679", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Group 7: Halogens (7 e-)", "position": [30, 90], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Group 0: Noble Gases (full)", "position": [30, 120], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Elements in the same group have SIMILAR chemical properties because they have the same number of outer electrons. This is why the periodic table is so useful — you can predict how an element will behave just by knowing its position. The table was first organised by Dmitri Mendeleev in 1869. He even left gaps for elements not yet discovered!",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "Same Group = Similar properties", "position": [30, 30], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Because: same outer electrons", "position": [30, 65], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Mendeleev (1869) - inventor", "position": [30, 110], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Excellent progress! Answer this question to lock in your XP.",
      "board_actions": [],
      "checkpoint": {
        "type": "mcq",
        "question": "Elements in the same GROUP of the periodic table have similar properties because they have the same number of:",
        "correct_answer": "Outer electrons",
        "options": ["Protons in the nucleus", "Outer electrons", "Neutrons in the nucleus", "Electron shells"],
        "hint": "Think about what the group number tells us about an element''s electron arrangement.",
        "xp_reward": 50
      }
    }
  ]',
  15,
  100
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SHS Social Studies: Arms of Government in Ghana
-- ─────────────────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-soc-government-01',
  'mensah',
  'social_studies',
  'shs',
  'Arms of Government in Ghana',
  '[
    {
      "step": 1,
      "voice_script": "Good morning, class! Today we are studying the three arms of government in Ghana. A well-functioning democracy needs a clear separation of power. No single person or body should control everything — not even the President. Ghana learned this lesson through many years of military coups and democratic struggles.",
      "board_actions": [
        { "action": "addLabel", "text": "3 Arms of Government", "position": [65, 25], "color": "#006B3F", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Separation of Powers", "position": [65, 55], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Prevents abuse of power", "position": [60, 85], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "The EXECUTIVE arm is responsible for running the country day-to-day. In Ghana, the Executive is headed by the President, who is both head of state and head of government. The President appoints ministers who head the various ministries — like the Ministry of Education, the Ministry of Health, and so on. The President serves a maximum of two four-year terms.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "ARM 1: The Executive", "position": [60, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Head: The President", "position": [30, 65], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Role: Runs the country", "position": [30, 95], "color": "#81C784", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Term: Max 2 x 4 years", "position": [30, 125], "color": "#4FC3F7", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "The LEGISLATURE is Parliament. Ghana has a unicameral parliament — meaning one house with 275 members of parliament elected from constituencies across the country. Parliament''s job is to make and amend laws, approve the national budget, and hold the executive accountable. Our Parliament is located in Accra, near the Jubilee House.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "ARM 2: The Legislature", "position": [55, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "= Parliament (275 MPs)", "position": [55, 60], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Role: Makes laws", "position": [30, 90], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Role: Approves budget", "position": [30, 115], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Role: Holds Exec accountable", "position": [30, 140], "color": "#81C784", "delay_ms": 1200 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "The JUDICIARY interprets and applies the law. It is headed by the Chief Justice and includes the Supreme Court, the Court of Appeal, the High Court, and the lower courts. The judiciary is independent — judges cannot be told by the President or Parliament what verdicts to deliver. This independence protects the rights of ordinary Ghanaians.",
      "board_actions": [
        { "action": "clearBoard", "delay_ms": 0 },
        { "action": "addLabel", "text": "ARM 3: The Judiciary", "position": [60, 25], "color": "#EF9F27", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Head: Chief Justice", "position": [30, 65], "color": "#FFFFFF", "delay_ms": 1500 },
        { "action": "addLabel", "text": "Role: Interprets the law", "position": [30, 95], "color": "#81C784", "delay_ms": 1200 },
        { "action": "addLabel", "text": "Supreme Court → lower courts", "position": [30, 125], "color": "#4FC3F7", "delay_ms": 1500 },
        { "action": "addLabel", "text": "INDEPENDENT of Executive", "position": [30, 155], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Wonderful! The three arms — Executive, Legislature, Judiciary — each check and balance the others. This is what makes Ghana a constitutional democracy. Now test yourself!",
      "board_actions": [],
      "checkpoint": {
        "type": "mcq",
        "question": "Which arm of government in Ghana has the power to declare a law unconstitutional?",
        "correct_answer": "The Judiciary",
        "options": ["The Executive (President)", "The Legislature (Parliament)", "The Judiciary", "The Electoral Commission"],
        "hint": "This arm interprets the constitution and can strike down laws that violate it.",
        "xp_reward": 50
      }
    }
  ]',
  16,
  100
);
