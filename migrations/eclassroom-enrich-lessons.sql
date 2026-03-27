-- eClassroom: Enrich board_actions for all 10 lessons
-- Adds visual structure: title bars, bullet markers, boxed key terms, diagrams, separator lines
-- Run AFTER eclassroom-foundation.sql and eclassroom-sample-lesson.sql / eclassroom-sample-lessons-batch.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SHS Math: Trigonometric Ratios (shs-math-trig-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good morning class! Today we are going to learn about trigonometric ratios. Let me draw a right-angled triangle on the board.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "TRIGONOMETRIC RATIOS", "position": [80, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "Step 1: The Right Triangle", "position": [15, 42], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawShape", "type": "triangle", "points": [[60,230],[230,230],[230,100]], "delay_ms": 1200 },
      { "action": "drawShape", "type": "rightAngleMarker", "position": [230,230], "delay_ms": 1500 },
      { "action": "addLabel", "text": "Right angle", "position": [235, 220], "color": "#FF5252", "delay_ms": 1800 },
      { "action": "drawLine", "points": [[55,235],[235,235]], "color": "#4FC3F7", "delay_ms": 600 },
      { "action": "addLabel", "text": "θ", "position": [75, 218], "color": "#FCD116", "delay_ms": 2000 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "This longest side, opposite the right angle, is called the hypotenuse. In Ghana, you might think of it like the longest path from your house to school.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "NAMING THE SIDES", "position": [100, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "triangle", "points": [[60,230],[230,230],[230,100]], "delay_ms": 800 },
      { "action": "drawShape", "type": "rightAngleMarker", "position": [230,230], "delay_ms": 1000 },
      { "action": "addLabel", "text": "θ", "position": [75, 218], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [100, 140], "width": 130, "height": 28, "delay_ms": 1200 },
      { "action": "addLabel", "text": "HYPOTENUSE", "position": [115, 148], "color": "#FCD116", "delay_ms": 1500 },
      { "action": "drawLine", "points": [[145,165],[145,175],[120,175]], "color": "#FCD116", "delay_ms": 1800 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "The side next to the angle we are looking at is called the adjacent side. And the side across from that angle is the opposite side.",
    "board_actions": [
      { "action": "drawShape", "type": "triangle", "points": [[60,230],[230,230],[230,100]], "delay_ms": 500 },
      { "action": "drawShape", "type": "rightAngleMarker", "position": [230,230], "delay_ms": 700 },
      { "action": "addLabel", "text": "θ", "position": [75, 218], "color": "#FCD116", "delay_ms": 700 },
      { "action": "drawShape", "type": "rectangle", "position": [90, 235], "width": 110, "height": 22, "delay_ms": 900 },
      { "action": "addLabel", "text": "ADJACENT", "position": [110, 240], "color": "#4FC3F7", "delay_ms": 1200 },
      { "action": "drawShape", "type": "rectangle", "position": [235, 140], "width": 100, "height": 22, "delay_ms": 1500 },
      { "action": "addLabel", "text": "OPPOSITE", "position": [248, 145], "color": "#81C784", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Hypotenuse", "position": [105, 150], "color": "#FCD116", "delay_ms": 2000 },
      { "action": "drawLine", "points": [[10,55],[160,55]], "color": "#ffffff", "delay_ms": 2200 },
      { "action": "addLabel", "text": "All 3 sides named!", "position": [15, 45], "color": "#ffffff", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Now here is the key formula. SOH CAH TOA! Sine equals Opposite over Hypotenuse. Cosine equals Adjacent over Hypotenuse. Tangent equals Opposite over Adjacent.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SOH  CAH  TOA", "position": [100, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 310, "height": 35, "delay_ms": 700 },
      { "action": "addLabel", "text": "•", "position": [20, 48], "color": "#FF5252", "delay_ms": 900 },
      { "action": "addLabel", "text": "SOH:  sin(θ) = Opposite / Hypotenuse", "position": [35, 48], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 85], "width": 310, "height": 35, "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [20, 93], "color": "#4FC3F7", "delay_ms": 1400 },
      { "action": "addLabel", "text": "CAH:  cos(θ) = Adjacent / Hypotenuse", "position": [35, 93], "color": "#ffffff", "delay_ms": 1500 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 130], "width": 310, "height": 35, "delay_ms": 1700 },
      { "action": "addLabel", "text": "•", "position": [20, 138], "color": "#81C784", "delay_ms": 1900 },
      { "action": "addLabel", "text": "TOA:  tan(θ) = Opposite / Adjacent", "position": [35, 138], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "drawLine", "points": [[15, 180],[335, 180]], "color": "#FCD116", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Memorise this — it''s on every WASSCE!", "position": [50, 195], "color": "#FCD116", "delay_ms": 2500 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Now it is your turn. What is cosine of angle A? Remember CAH — Cosine equals Adjacent over Hypotenuse. Type your answer below.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "YOUR TURN!", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [40, 50], "width": 260, "height": 45, "delay_ms": 700 },
      { "action": "addLabel", "text": "What is cos(A)?", "position": [110, 65], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Hint: Remember C-A-H", "position": [100, 120], "color": "#4FC3F7", "delay_ms": 1500 },
      { "action": "drawLine", "points": [[100, 140],[240, 140]], "color": "#4FC3F7", "delay_ms": 1800 }
    ],
    "checkpoint": {
      "type": "text_input",
      "question": "What is cos(A)?",
      "correct_answer": "Adjacent/Hypotenuse",
      "accept_variations": ["adj/hyp", "adjacent over hypotenuse", "Adj/Hyp", "A/H"],
      "hint": "Remember CAH — Cosine equals Adjacent over Hypotenuse",
      "xp_reward": 50
    }
  }
]' WHERE id = 'shs-math-trig-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. JHS Math: Addition of Fractions (jhs-math-fractions-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good morning everyone! Today we are learning how to add fractions. Fractions are everywhere in our daily life. When Mama cuts a loaf of bread into equal pieces, she is working with fractions. Let me draw this on the board.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "ADDING FRACTIONS", "position": [95, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "A fraction = part of a whole", "position": [15, 45], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 65], "width": 200, "height": 40, "delay_ms": 1000 },
      { "action": "drawLine", "points": [[80,65],[80,105]], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "drawLine", "points": [[130,65],[130,105]], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "drawLine", "points": [[180,65],[180,105]], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "1/4", "position": [45, 78], "color": "#81C784", "delay_ms": 1500 },
      { "action": "addLabel", "text": "2/4", "position": [120, 78], "color": "#4FC3F7", "delay_ms": 1500 },
      { "action": "drawLine", "points": [[30,120],[230,120]], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Each piece = 1/4 of the bread", "position": [15, 135], "color": "#ffffff", "delay_ms": 2000 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "When fractions have the SAME denominator, adding is simple. You just add the top numbers — the numerators — and keep the bottom number. For example, one-quarter plus two-quarters. Look at this.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SAME DENOMINATORS", "position": [90, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 200, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Rule: Add numerators, keep denominator", "position": [20, 48], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "addLabel", "text": "•", "position": [15, 85], "color": "#81C784", "delay_ms": 1000 },
      { "action": "addLabel", "text": "1/4 + 2/4", "position": [30, 85], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "drawLine", "points": [[30,100],[150,100]], "color": "#ffffff", "delay_ms": 1400 },
      { "action": "addLabel", "text": "•", "position": [15, 115], "color": "#81C784", "delay_ms": 1500 },
      { "action": "addLabel", "text": "= (1+2) / 4", "position": [30, 115], "color": "#FCD116", "delay_ms": 1700 },
      { "action": "drawShape", "type": "rectangle", "position": [25, 135], "width": 80, "height": 28, "delay_ms": 1900 },
      { "action": "addLabel", "text": "= 3/4", "position": [40, 143], "color": "#81C784", "delay_ms": 2100 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "But what if the denominators are DIFFERENT? Like one-half plus one-third? Here we must find the Lowest Common Denominator — the LCM. Think of it as finding a common meeting point, like choosing a chop bar that is convenient for everyone.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "DIFFERENT DENOMINATORS", "position": [75, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "1/2 + 1/3 = ?", "position": [120, 45], "color": "#ffffff", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,60],[335,60]], "color": "#4FC3F7", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 70], "width": 250, "height": 28, "delay_ms": 1200 },
      { "action": "addLabel", "text": "Step 1: Find LCM of 2 and 3", "position": [20, 78], "color": "#4FC3F7", "delay_ms": 1400 },
      { "action": "addLabel", "text": "•", "position": [15, 115], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "LCM = 6", "position": [30, 115], "color": "#FCD116", "delay_ms": 1800 },
      { "action": "addLabel", "text": "•", "position": [15, 140], "color": "#81C784", "delay_ms": 2000 },
      { "action": "addLabel", "text": "1/2 = 3/6   (multiply by 3)", "position": [30, 140], "color": "#81C784", "delay_ms": 2200 },
      { "action": "addLabel", "text": "•", "position": [15, 165], "color": "#81C784", "delay_ms": 2400 },
      { "action": "addLabel", "text": "1/3 = 2/6   (multiply by 2)", "position": [30, 165], "color": "#81C784", "delay_ms": 2600 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Once both fractions share the same denominator, we add the numerators just as before. Three-sixths plus two-sixths equals five-sixths. This is the answer! Now try this question.",
    "board_actions": [
      { "action": "drawLine", "points": [[15,190],[335,190]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "Step 2: Now add!", "position": [15, 205], "color": "#FCD116", "delay_ms": 500 },
      { "action": "addLabel", "text": "•", "position": [15, 225], "color": "#81C784", "delay_ms": 700 },
      { "action": "addLabel", "text": "3/6 + 2/6 = 5/6", "position": [30, 225], "color": "#ffffff", "delay_ms": 900 },
      { "action": "drawShape", "type": "rectangle", "position": [200, 215], "width": 100, "height": 28, "delay_ms": 1100 },
      { "action": "addLabel", "text": "Answer: 5/6", "position": [210, 223], "color": "#81C784", "delay_ms": 1300 }
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
]' WHERE id = 'jhs-math-fractions-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JHS Math: Percentages and Discounts (jhs-math-percentages-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Akwaaba class! Today we tackle percentages. You see percentage signs every day — at Accra Mall, Kejetia Market, in your maths textbook. Percent simply means out of one hundred. The word comes from Latin: per centum — per hundred.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "PERCENTAGES & DISCOUNTS", "position": [65, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 280, "height": 28, "delay_ms": 700 },
      { "action": "addLabel", "text": "Percent = Per 100 (out of 100)", "position": [25, 48], "color": "#FCD116", "delay_ms": 900 },
      { "action": "addLabel", "text": "•", "position": [15, 85], "color": "#81C784", "delay_ms": 1100 },
      { "action": "addLabel", "text": "50%  =  50/100  =  0.5", "position": [30, 85], "color": "#81C784", "delay_ms": 1300 },
      { "action": "addLabel", "text": "•", "position": [15, 110], "color": "#4FC3F7", "delay_ms": 1500 },
      { "action": "addLabel", "text": "25%  =  25/100  =  0.25", "position": [30, 110], "color": "#4FC3F7", "delay_ms": 1700 },
      { "action": "addLabel", "text": "•", "position": [15, 135], "color": "#FCD116", "delay_ms": 1900 },
      { "action": "addLabel", "text": "100% =  100/100 =  1.0 (the whole)", "position": [30, 135], "color": "#FCD116", "delay_ms": 2100 },
      { "action": "drawLine", "points": [[15,155],[335,155]], "color": "#ffffff", "delay_ms": 2300 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "To find a percentage of an amount, multiply the amount by the percentage, then divide by 100. Suppose Kofi buys a bag of rice for 200 Ghana cedis and the seller gives him a 10 percent discount. How much does he save? 10 percent of 200 cedis.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "FINDING A PERCENTAGE", "position": [85, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 38], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Formula: (Percent / 100) x Amount", "position": [25, 46], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,80],[335,80]], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Example: 10% of GHS 200", "position": [15, 95], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 120], "color": "#ffffff", "delay_ms": 1400 },
      { "action": "addLabel", "text": "= (10/100) x 200", "position": [30, 120], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 145], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "addLabel", "text": "= 0.10 x 200", "position": [30, 145], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "drawShape", "type": "rectangle", "position": [25, 165], "width": 160, "height": 28, "delay_ms": 2200 },
      { "action": "addLabel", "text": "= GHS 20 saved!", "position": [40, 173], "color": "#81C784", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "Now the discounted price is the original price minus the discount amount. So Kofi pays 200 minus 20, which equals 180 Ghana cedis. This is how traders at Makola Market calculate sale prices every day.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "CALCULATING DISCOUNT PRICE", "position": [60, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Discounted Price = Original - Discount", "position": [20, 48], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "addLabel", "text": "•", "position": [15, 85], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Original price:   GHS 200", "position": [30, 85], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 110], "color": "#FF5252", "delay_ms": 1400 },
      { "action": "addLabel", "text": "Discount amount:  GHS  20", "position": [30, 110], "color": "#FF5252", "delay_ms": 1600 },
      { "action": "drawLine", "points": [[25,130],[250,130]], "color": "#FCD116", "delay_ms": 1800 },
      { "action": "drawShape", "type": "rectangle", "position": [25, 140], "width": 200, "height": 30, "delay_ms": 2000 },
      { "action": "addLabel", "text": "Kofi pays: GHS 180", "position": [45, 149], "color": "#81C784", "delay_ms": 2200 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Let me also show you how to express one number as a percentage of another. If Ama scores 36 out of 50 in a test, what is her percentage score? Divide 36 by 50, then multiply by 100. Let us work it out together.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "CONVERTING TO PERCENTAGE", "position": [70, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Formula: (Score / Total) x 100", "position": [35, 48], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,80],[335,80]], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Ama''s score: 36 out of 50", "position": [15, 95], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 120], "color": "#ffffff", "delay_ms": 1400 },
      { "action": "addLabel", "text": "= (36 / 50) x 100", "position": [30, 120], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 145], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "addLabel", "text": "= 0.72 x 100", "position": [30, 145], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "drawShape", "type": "rectangle", "position": [25, 165], "width": 120, "height": 30, "delay_ms": 2200 },
      { "action": "addLabel", "text": "= 72%", "position": [55, 174], "color": "#81C784", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Excellent! Now your turn. A shirt originally costs 150 Ghana cedis. A shop at Accra Mall offers a 20 percent discount. What is the discounted price? Type your answer in cedis.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "YOUR TURN!", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 50], "width": 280, "height": 60, "delay_ms": 700 },
      { "action": "addLabel", "text": "Shirt price: GHS 150", "position": [55, 65], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Discount: 20%", "position": [55, 85], "color": "#FF5252", "delay_ms": 1300 },
      { "action": "addLabel", "text": "What is the discounted price?", "position": [60, 135], "color": "#FCD116", "delay_ms": 1600 }
    ],
    "checkpoint": {
      "type": "text_input",
      "question": "A shirt costs GHS 150. A 20% discount is applied. What is the discounted price?",
      "correct_answer": "GHS 120",
      "accept_variations": ["120", "120 cedis", "GHS120", "gh 120", "ghs 120", "one hundred and twenty"],
      "hint": "First find 20% of 150, then subtract from 150.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'jhs-math-percentages-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. JHS Science: Photosynthesis (jhs-sci-photosynthesis-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good day scientists! Have you ever wondered how the cocoa tree in your village, or the neem tree in your compound, makes its own food? Today we discover the answer — photosynthesis! This is one of the most important processes on Earth.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "PHOTOSYNTHESIS", "position": [95, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "\"Photo\" = Light    \"Synthesis\" = Making", "position": [15, 48], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 65], "width": 300, "height": 28, "delay_ms": 1000 },
      { "action": "addLabel", "text": "= How plants make food using light", "position": [25, 73], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "drawLine", "points": [[15,110],[335,110]], "color": "#81C784", "delay_ms": 1400 },
      { "action": "drawShape", "type": "circle", "position": [80, 160], "width": 50, "height": 50, "delay_ms": 1600 },
      { "action": "addLabel", "text": "SUN", "position": [95, 162], "color": "#FCD116", "delay_ms": 1800 },
      { "action": "drawLine", "points": [[130,160],[180,160]], "color": "#FCD116", "delay_ms": 2000 },
      { "action": "addLabel", "text": "LEAF", "position": [190, 155], "color": "#81C784", "delay_ms": 2200 },
      { "action": "addLabel", "text": "FOOD!", "position": [260, 155], "color": "#FCD116", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "Plants need three things to make food: sunlight, water from the soil, and carbon dioxide from the air. The green pigment inside leaves — chlorophyll — traps the energy from sunlight. In Ghana, our plants are very fortunate because we get plenty of sunshine!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "INPUTS (What plants need)", "position": [70, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 200, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "1. Sunlight (energy source)", "position": [20, 48], "color": "#FCD116", "delay_ms": 800 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 78], "width": 200, "height": 28, "delay_ms": 1000 },
      { "action": "addLabel", "text": "2. Water H2O (from roots)", "position": [20, 86], "color": "#4FC3F7", "delay_ms": 1200 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 116], "width": 210, "height": 28, "delay_ms": 1400 },
      { "action": "addLabel", "text": "3. Carbon dioxide CO2 (air)", "position": [20, 124], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "drawLine", "points": [[15,160],[335,160]], "color": "#81C784", "delay_ms": 1800 },
      { "action": "drawShape", "type": "rectangle", "position": [50, 170], "width": 230, "height": 28, "delay_ms": 2000 },
      { "action": "addLabel", "text": "CHLOROPHYLL traps the sunlight", "position": [55, 178], "color": "#81C784", "delay_ms": 2200 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "The chlorophyll uses sunlight energy to combine water and carbon dioxide and produce two outputs: glucose — which is the plant''s food — and oxygen, which is released into the air. That oxygen is what we breathe! So trees are keeping us alive.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "OUTPUTS (What plants produce)", "position": [60, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 50], "width": 100, "height": 60, "delay_ms": 600 },
      { "action": "addLabel", "text": "INPUTS", "position": [55, 57], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "addLabel", "text": "CO2 + H2O", "position": [42, 77], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "drawLine", "points": [[135,80],[175,80]], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "→", "position": [150, 75], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "drawShape", "type": "circle", "position": [200, 65], "width": 50, "height": 50, "delay_ms": 1400 },
      { "action": "addLabel", "text": "LEAF", "position": [213, 80], "color": "#81C784", "delay_ms": 1400 },
      { "action": "drawLine", "points": [[255,80],[295,80]], "color": "#FCD116", "delay_ms": 1600 },
      { "action": "addLabel", "text": "→", "position": [270, 75], "color": "#FCD116", "delay_ms": 1600 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 130], "width": 160, "height": 28, "delay_ms": 1800 },
      { "action": "addLabel", "text": "Output 1: Glucose (food)", "position": [20, 138], "color": "#FCD116", "delay_ms": 2000 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 168], "width": 200, "height": 28, "delay_ms": 2200 },
      { "action": "addLabel", "text": "Output 2: Oxygen O2 (we breathe!)", "position": [20, 176], "color": "#81C784", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Here is the word equation summarising photosynthesis. Carbon dioxide plus water, in the presence of sunlight and chlorophyll, produces glucose plus oxygen. Memorise this — it will come in your BECE exam!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "THE EQUATION (Memorise!)", "position": [70, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 45], "width": 310, "height": 85, "delay_ms": 600 },
      { "action": "addLabel", "text": "CO2  +  H2O", "position": [40, 60], "color": "#4FC3F7", "delay_ms": 900 },
      { "action": "addLabel", "text": "sunlight", "position": [120, 80], "color": "#FCD116", "delay_ms": 1100 },
      { "action": "drawLine", "points": [[40,95],[300,95]], "color": "#FCD116", "delay_ms": 1300 },
      { "action": "addLabel", "text": "chlorophyll", "position": [110, 100], "color": "#81C784", "delay_ms": 1300 },
      { "action": "addLabel", "text": "Glucose  +  O2", "position": [60, 115], "color": "#81C784", "delay_ms": 1600 },
      { "action": "drawLine", "points": [[15,150],[335,150]], "color": "#FF5252", "delay_ms": 1800 },
      { "action": "addLabel", "text": "BECE TIP: This equation is always tested!", "position": [25, 165], "color": "#FF5252", "delay_ms": 2000 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Excellent work! Let us check what you have learned. Answer this question carefully.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "CHECKPOINT", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 60], "width": 280, "height": 50, "delay_ms": 700 },
      { "action": "addLabel", "text": "Which part of the plant", "position": [70, 72], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "traps sunlight energy?", "position": [75, 90], "color": "#FCD116", "delay_ms": 1300 }
    ],
    "checkpoint": {
      "type": "mcq",
      "question": "Which part of the plant traps sunlight energy for photosynthesis?",
      "correct_answer": "Chlorophyll",
      "options": ["The roots", "Chlorophyll", "The stem", "The flower"],
      "hint": "Think about what makes leaves green.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'jhs-sci-photosynthesis-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. JHS English: Reading Comprehension Skills (jhs-eng-comprehension-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Welcome, dear students! Today we are going to sharpen your reading comprehension skills — one of the most important skills you will ever develop. Whether you are reading a newspaper, a letter from a relative, or your BECE exam paper, comprehension is your key to understanding.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "READING COMPREHENSION", "position": [75, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 42], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "= Understanding what you read", "position": [55, 50], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,85],[335,85]], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "3 Key Strategies:", "position": [15, 100], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 125], "color": "#81C784", "delay_ms": 1400 },
      { "action": "addLabel", "text": "1. Read Twice", "position": [30, 125], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 150], "color": "#4FC3F7", "delay_ms": 1800 },
      { "action": "addLabel", "text": "2. Use the Passage", "position": [30, 150], "color": "#4FC3F7", "delay_ms": 2000 },
      { "action": "addLabel", "text": "•", "position": [15, 175], "color": "#FCD116", "delay_ms": 2200 },
      { "action": "addLabel", "text": "3. Find the Main Idea", "position": [30, 175], "color": "#FCD116", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "The first strategy is: READ THE PASSAGE TWICE. The first time, read quickly for the general idea — what is this passage about? The second time, read slowly and carefully. Look for key words, names, dates, and repeated ideas. This is just like when you listen to a story at your grandmother''s house — the second time you hear it, you notice more details.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "STRATEGY 1: READ TWICE", "position": [75, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 45], "width": 310, "height": 55, "delay_ms": 600 },
      { "action": "addLabel", "text": "1st READ (fast):", "position": [25, 55], "color": "#FCD116", "delay_ms": 900 },
      { "action": "addLabel", "text": "Get the general idea", "position": [40, 75], "color": "#ffffff", "delay_ms": 1100 },
      { "action": "drawLine", "points": [[15,115],[335,115]], "color": "#81C784", "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 125], "width": 310, "height": 55, "delay_ms": 1500 },
      { "action": "addLabel", "text": "2nd READ (slow):", "position": [25, 135], "color": "#4FC3F7", "delay_ms": 1700 },
      { "action": "addLabel", "text": "Find details, key words, dates", "position": [40, 155], "color": "#ffffff", "delay_ms": 1900 },
      { "action": "drawLine", "points": [[15,195],[335,195]], "color": "#FCD116", "delay_ms": 2100 },
      { "action": "addLabel", "text": "Like hearing a story twice at grandma''s!", "position": [25, 210], "color": "#FCD116", "delay_ms": 2300 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "Strategy two: ANSWER USING THE PASSAGE. Many students make the mistake of writing what they already know from their own experience. But comprehension questions must be answered using ONLY information from the passage. Underline key sentences as you read — they often contain the answers.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#4FC3F7", "delay_ms": 300 },
      { "action": "addLabel", "text": "STRATEGY 2: USE THE PASSAGE", "position": [55, 12], "color": "#4FC3F7", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#4FC3F7", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 50], "width": 150, "height": 60, "delay_ms": 700 },
      { "action": "addLabel", "text": "DO:", "position": [25, 58], "color": "#81C784", "delay_ms": 900 },
      { "action": "addLabel", "text": "•", "position": [25, 78], "color": "#81C784", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Quote the passage", "position": [35, 78], "color": "#81C784", "delay_ms": 1100 },
      { "action": "addLabel", "text": "•", "position": [25, 93], "color": "#81C784", "delay_ms": 1200 },
      { "action": "addLabel", "text": "Paraphrase it", "position": [35, 93], "color": "#81C784", "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [180, 50], "width": 155, "height": 60, "delay_ms": 1500 },
      { "action": "addLabel", "text": "DON''T:", "position": [190, 58], "color": "#FF5252", "delay_ms": 1700 },
      { "action": "addLabel", "text": "•", "position": [190, 78], "color": "#FF5252", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Use own knowledge", "position": [200, 78], "color": "#FF5252", "delay_ms": 1900 },
      { "action": "addLabel", "text": "•", "position": [190, 93], "color": "#FF5252", "delay_ms": 2000 },
      { "action": "addLabel", "text": "Guess or assume", "position": [200, 93], "color": "#FF5252", "delay_ms": 2100 },
      { "action": "drawLine", "points": [[15,130],[335,130]], "color": "#FCD116", "delay_ms": 2300 },
      { "action": "addLabel", "text": "TIP: Underline key sentences as you read!", "position": [20, 145], "color": "#FCD116", "delay_ms": 2500 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Strategy three: LOOK FOR THE MAIN IDEA. Every passage has a main idea — what the writer is mostly talking about. It is usually in the first paragraph, sometimes in the last. Ask yourself: if I had to tell a friend what this passage is about in ONE sentence, what would I say? That sentence is your main idea. Now let me test you!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "STRATEGY 3: FIND THE MAIN IDEA", "position": [40, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "Where to look:", "position": [15, 48], "color": "#4FC3F7", "delay_ms": 700 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 60], "width": 150, "height": 45, "delay_ms": 900 },
      { "action": "addLabel", "text": "First paragraph", "position": [35, 68], "color": "#81C784", "delay_ms": 1100 },
      { "action": "addLabel", "text": "(most common)", "position": [40, 85], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "OR", "position": [175, 78], "color": "#FCD116", "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [195, 60], "width": 140, "height": 45, "delay_ms": 1400 },
      { "action": "addLabel", "text": "Last paragraph", "position": [210, 68], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "(conclusion)", "position": [220, 85], "color": "#ffffff", "delay_ms": 1700 },
      { "action": "drawLine", "points": [[15,125],[335,125]], "color": "#FCD116", "delay_ms": 1900 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 135], "width": 320, "height": 35, "delay_ms": 2100 },
      { "action": "addLabel", "text": "TEST: Can you summarise it in ONE sentence?", "position": [20, 147], "color": "#FCD116", "delay_ms": 2300 },
      { "action": "addLabel", "text": "If yes → you found the main idea!", "position": [50, 190], "color": "#81C784", "delay_ms": 2500 }
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
]' WHERE id = 'jhs-eng-comprehension-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. JHS Social Studies: Ghana''s 1992 Constitution (jhs-soc-constitution-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good morning, future citizens! Today we are studying one of the most important documents in our country — the 1992 Constitution of Ghana. The constitution is the supreme law of the land. It is above every other law, above every person, including the President. No law in Ghana can contradict the constitution.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "addLabel", "text": "GHANA''S 1992 CONSTITUTION", "position": [60, 12], "color": "#006B3F", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [40, 50], "width": 260, "height": 35, "delay_ms": 700 },
      { "action": "addLabel", "text": "THE SUPREME LAW OF GHANA", "position": [60, 61], "color": "#FCD116", "delay_ms": 900 },
      { "action": "drawLine", "points": [[15,100],[335,100]], "color": "#ffffff", "delay_ms": 1100 },
      { "action": "addLabel", "text": "•", "position": [15, 115], "color": "#006B3F", "delay_ms": 1300 },
      { "action": "addLabel", "text": "Above ALL other laws", "position": [30, 115], "color": "#ffffff", "delay_ms": 1500 },
      { "action": "addLabel", "text": "•", "position": [15, 140], "color": "#006B3F", "delay_ms": 1700 },
      { "action": "addLabel", "text": "Above ALL persons (even the President)", "position": [30, 140], "color": "#ffffff", "delay_ms": 1900 },
      { "action": "addLabel", "text": "•", "position": [15, 165], "color": "#006B3F", "delay_ms": 2100 },
      { "action": "addLabel", "text": "No law can contradict it", "position": [30, 165], "color": "#FF5252", "delay_ms": 2300 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "Ghana returned to constitutional rule on 7th January 1993, when the Fourth Republic was inaugurated under President Jerry John Rawlings. The constitution was adopted in April 1992 through a national referendum — meaning Ghanaian citizens voted YES or NO on whether to accept it. About 92 percent voted YES.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "KEY DATES & HISTORY", "position": [90, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawLine", "points": [[50,50],[50,200]], "color": "#4FC3F7", "delay_ms": 600 },
      { "action": "drawShape", "type": "circle", "position": [43, 55], "width": 14, "height": 14, "delay_ms": 800 },
      { "action": "addLabel", "text": "Apr 1992", "position": [70, 55], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "National referendum held", "position": [150, 55], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "drawShape", "type": "circle", "position": [43, 100], "width": 14, "height": 14, "delay_ms": 1400 },
      { "action": "addLabel", "text": "~92%", "position": [70, 100], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "Citizens voted YES", "position": [120, 100], "color": "#81C784", "delay_ms": 1800 },
      { "action": "drawShape", "type": "circle", "position": [43, 145], "width": 14, "height": 14, "delay_ms": 2000 },
      { "action": "addLabel", "text": "7 Jan 1993", "position": [70, 145], "color": "#FCD116", "delay_ms": 2200 },
      { "action": "addLabel", "text": "4th Republic begins", "position": [160, 145], "color": "#ffffff", "delay_ms": 2400 },
      { "action": "addLabel", "text": "President: J.J. Rawlings", "position": [70, 185], "color": "#4FC3F7", "delay_ms": 2600 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "The constitution divides government power into THREE arms. The Executive — led by the President, who runs the country. The Legislature — Parliament, which makes laws. And the Judiciary — the courts, which interpret the laws. This separation of powers prevents any one person or group from having too much control.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "3 ARMS OF GOVERNMENT", "position": [80, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "Separation of Powers", "position": [100, 42], "color": "#4FC3F7", "delay_ms": 700 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 60], "width": 100, "height": 55, "delay_ms": 900 },
      { "action": "addLabel", "text": "EXECUTIVE", "position": [25, 68], "color": "#FCD116", "delay_ms": 1100 },
      { "action": "addLabel", "text": "President", "position": [30, 85], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "Runs country", "position": [25, 100], "color": "#ffffff", "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [125, 60], "width": 100, "height": 55, "delay_ms": 1400 },
      { "action": "addLabel", "text": "LEGISLATURE", "position": [130, 68], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "Parliament", "position": [137, 85], "color": "#ffffff", "delay_ms": 1700 },
      { "action": "addLabel", "text": "Makes laws", "position": [138, 100], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "drawShape", "type": "rectangle", "position": [235, 60], "width": 100, "height": 55, "delay_ms": 1900 },
      { "action": "addLabel", "text": "JUDICIARY", "position": [250, 68], "color": "#4FC3F7", "delay_ms": 2100 },
      { "action": "addLabel", "text": "Courts", "position": [260, 85], "color": "#ffffff", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Interprets law", "position": [243, 100], "color": "#ffffff", "delay_ms": 2300 },
      { "action": "drawLine", "points": [[65,120],[175,140]], "color": "#FCD116", "delay_ms": 2500 },
      { "action": "drawLine", "points": [[175,140],[285,120]], "color": "#FCD116", "delay_ms": 2500 },
      { "action": "drawLine", "points": [[65,120],[285,120]], "color": "#FCD116", "delay_ms": 2500 },
      { "action": "addLabel", "text": "Checks & Balances", "position": [125, 155], "color": "#FCD116", "delay_ms": 2700 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "The constitution also guarantees the fundamental human rights of every Ghanaian. This includes the right to life, freedom of speech, freedom of religion, and the right to education. These rights are in Chapter Five of the constitution and cannot be taken away from you.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "CHAPTER 5: FUNDAMENTAL RIGHTS", "position": [45, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 45], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Rights that CANNOT be taken away", "position": [40, 53], "color": "#FCD116", "delay_ms": 800 },
      { "action": "addLabel", "text": "•", "position": [15, 90], "color": "#81C784", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Right to LIFE", "position": [30, 90], "color": "#81C784", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 115], "color": "#81C784", "delay_ms": 1400 },
      { "action": "addLabel", "text": "Freedom of SPEECH", "position": [30, 115], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 140], "color": "#81C784", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Freedom of RELIGION", "position": [30, 140], "color": "#81C784", "delay_ms": 2000 },
      { "action": "addLabel", "text": "•", "position": [15, 165], "color": "#81C784", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Right to EDUCATION", "position": [30, 165], "color": "#81C784", "delay_ms": 2400 },
      { "action": "drawLine", "points": [[15,185],[335,185]], "color": "#FF5252", "delay_ms": 2600 },
      { "action": "addLabel", "text": "Protected by law — for EVERY Ghanaian!", "position": [35, 200], "color": "#FF5252", "delay_ms": 2800 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Well done! Let us see how much you have learned about our constitution.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "addLabel", "text": "QUIZ TIME!", "position": [125, 12], "color": "#006B3F", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 60], "width": 280, "height": 50, "delay_ms": 700 },
      { "action": "addLabel", "text": "Which arm of government", "position": [65, 72], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "makes laws in Ghana?", "position": [80, 90], "color": "#FCD116", "delay_ms": 1300 }
    ],
    "checkpoint": {
      "type": "mcq",
      "question": "Which arm of government is responsible for making laws in Ghana?",
      "correct_answer": "Legislature (Parliament)",
      "options": ["The Executive (President)", "Legislature (Parliament)", "The Judiciary (Courts)", "The Electoral Commission"],
      "hint": "Think about which arm was described as making laws, not enforcing or interpreting them.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'jhs-soc-constitution-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SHS Math: Solving Quadratic Equations (shs-math-quadratic-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Welcome back, class! Today we are solving quadratic equations — a very common topic in your WASSCE Core Mathematics paper. A quadratic equation is any equation where the highest power of x is 2. Think of it as a square — just as a square plot of land has area x squared.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "QUADRATIC EQUATIONS", "position": [80, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 45], "width": 280, "height": 30, "delay_ms": 600 },
      { "action": "addLabel", "text": "Standard Form: ax² + bx + c = 0", "position": [45, 54], "color": "#4FC3F7", "delay_ms": 900 },
      { "action": "drawLine", "points": [[15,90],[335,90]], "color": "#ffffff", "delay_ms": 1100 },
      { "action": "addLabel", "text": "Example:", "position": [15, 105], "color": "#FCD116", "delay_ms": 1300 },
      { "action": "addLabel", "text": "x² - 5x + 6 = 0", "position": [100, 105], "color": "#ffffff", "delay_ms": 1500 },
      { "action": "addLabel", "text": "a=1, b=-5, c=6", "position": [100, 130], "color": "#4FC3F7", "delay_ms": 1700 },
      { "action": "drawLine", "points": [[15,155],[335,155]], "color": "#FCD116", "delay_ms": 1900 },
      { "action": "addLabel", "text": "2 Methods: Factorisation or Formula", "position": [40, 170], "color": "#FCD116", "delay_ms": 2100 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "The first method is factorisation. For the equation x squared minus 5x plus 6 equals zero, we look for two numbers that MULTIPLY to give +6 and ADD to give -5. Let us think... negative 2 and negative 3: they multiply to +6 and add to -5. Perfect!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "METHOD 1: FACTORISATION", "position": [70, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "x² - 5x + 6 = 0", "position": [100, 45], "color": "#ffffff", "delay_ms": 700 },
      { "action": "drawLine", "points": [[15,60],[335,60]], "color": "#4FC3F7", "delay_ms": 900 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 70], "width": 310, "height": 30, "delay_ms": 1100 },
      { "action": "addLabel", "text": "Find 2 numbers: multiply=+6, add=-5", "position": [25, 79], "color": "#4FC3F7", "delay_ms": 1300 },
      { "action": "addLabel", "text": "•", "position": [15, 120], "color": "#81C784", "delay_ms": 1500 },
      { "action": "addLabel", "text": "Try: -2 and -3", "position": [30, 120], "color": "#ffffff", "delay_ms": 1700 },
      { "action": "addLabel", "text": "•", "position": [15, 145], "color": "#81C784", "delay_ms": 1900 },
      { "action": "addLabel", "text": "(-2) x (-3) = +6", "position": [30, 145], "color": "#81C784", "delay_ms": 2100 },
      { "action": "addLabel", "text": "✓", "position": [200, 145], "color": "#81C784", "delay_ms": 2100 },
      { "action": "addLabel", "text": "•", "position": [15, 170], "color": "#81C784", "delay_ms": 2300 },
      { "action": "addLabel", "text": "(-2) + (-3) = -5", "position": [30, 170], "color": "#81C784", "delay_ms": 2500 },
      { "action": "addLabel", "text": "✓", "position": [200, 170], "color": "#81C784", "delay_ms": 2500 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "Now we write the equation in factored form: x minus 2, times x minus 3, equals zero. When a product equals zero, at least one factor must be zero. So either x minus 2 equals zero, giving x equals 2; or x minus 3 equals zero, giving x equals 3. These are the two solutions!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SOLVING BY FACTORS", "position": [90, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [40, 40], "width": 260, "height": 30, "delay_ms": 600 },
      { "action": "addLabel", "text": "(x - 2)(x - 3) = 0", "position": [95, 49], "color": "#FCD116", "delay_ms": 900 },
      { "action": "drawLine", "points": [[15,85],[335,85]], "color": "#ffffff", "delay_ms": 1100 },
      { "action": "addLabel", "text": "If A x B = 0, then A=0 or B=0", "position": [40, 100], "color": "#4FC3F7", "delay_ms": 1300 },
      { "action": "drawLine", "points": [[175,115],[175,200]], "color": "#ffffff", "delay_ms": 1500 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 125], "width": 150, "height": 50, "delay_ms": 1700 },
      { "action": "addLabel", "text": "x - 2 = 0", "position": [45, 137], "color": "#ffffff", "delay_ms": 1900 },
      { "action": "addLabel", "text": "x = 2", "position": [60, 157], "color": "#81C784", "delay_ms": 2100 },
      { "action": "drawShape", "type": "rectangle", "position": [185, 125], "width": 150, "height": 50, "delay_ms": 2300 },
      { "action": "addLabel", "text": "x - 3 = 0", "position": [215, 137], "color": "#ffffff", "delay_ms": 2500 },
      { "action": "addLabel", "text": "x = 3", "position": [230, 157], "color": "#81C784", "delay_ms": 2700 },
      { "action": "drawLine", "points": [[15,195],[335,195]], "color": "#FCD116", "delay_ms": 2900 },
      { "action": "addLabel", "text": "Solutions: x = 2 or x = 3", "position": [80, 210], "color": "#FCD116", "delay_ms": 3100 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "When factorisation is difficult, we use the QUADRATIC FORMULA. This formula works for EVERY quadratic equation. x equals negative b, plus or minus the square root of b squared minus 4ac, all over 2a. Write this down — it is provided in WASSCE exams but you must know how to use it.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FF5252", "delay_ms": 300 },
      { "action": "addLabel", "text": "THE QUADRATIC FORMULA", "position": [75, 12], "color": "#FF5252", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FF5252", "delay_ms": 300 },
      { "action": "addLabel", "text": "Works for ALL quadratics!", "position": [80, 45], "color": "#4FC3F7", "delay_ms": 700 },
      { "action": "drawShape", "type": "rectangle", "position": [20, 60], "width": 300, "height": 65, "delay_ms": 900 },
      { "action": "addLabel", "text": "x = -b ± √(b² - 4ac)", "position": [65, 75], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "drawLine", "points": [[55,95],[275,95]], "color": "#FCD116", "delay_ms": 1500 },
      { "action": "addLabel", "text": "2a", "position": [155, 108], "color": "#FCD116", "delay_ms": 1800 },
      { "action": "drawLine", "points": [[15,145],[335,145]], "color": "#4FC3F7", "delay_ms": 2000 },
      { "action": "addLabel", "text": "b² - 4ac is the DISCRIMINANT", "position": [50, 160], "color": "#4FC3F7", "delay_ms": 2200 },
      { "action": "addLabel", "text": "•", "position": [15, 185], "color": "#81C784", "delay_ms": 2400 },
      { "action": "addLabel", "text": "> 0 → two real solutions", "position": [30, 185], "color": "#81C784", "delay_ms": 2600 },
      { "action": "addLabel", "text": "•", "position": [15, 210], "color": "#FCD116", "delay_ms": 2800 },
      { "action": "addLabel", "text": "= 0 → one repeated solution", "position": [30, 210], "color": "#FCD116", "delay_ms": 3000 },
      { "action": "addLabel", "text": "•", "position": [15, 235], "color": "#FF5252", "delay_ms": 3200 },
      { "action": "addLabel", "text": "< 0 → no real solutions", "position": [30, 235], "color": "#FF5252", "delay_ms": 3400 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Let us apply the formula to x squared plus 2x minus 3 equals zero. Here a equals 1, b equals 2, c equals negative 3. The discriminant — b squared minus 4ac — is 4 plus 12, which is 16. The square root of 16 is 4. So x equals negative 2 plus or minus 4, over 2.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "APPLYING THE FORMULA", "position": [85, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "x² + 2x - 3 = 0", "position": [100, 45], "color": "#ffffff", "delay_ms": 700 },
      { "action": "drawShape", "type": "rectangle", "position": [50, 60], "width": 240, "height": 25, "delay_ms": 900 },
      { "action": "addLabel", "text": "a = 1,  b = 2,  c = -3", "position": [80, 67], "color": "#4FC3F7", "delay_ms": 1100 },
      { "action": "drawLine", "points": [[15,100],[335,100]], "color": "#ffffff", "delay_ms": 1300 },
      { "action": "addLabel", "text": "•", "position": [15, 115], "color": "#FCD116", "delay_ms": 1500 },
      { "action": "addLabel", "text": "Discriminant: b²-4ac = 4+12 = 16", "position": [30, 115], "color": "#FCD116", "delay_ms": 1700 },
      { "action": "addLabel", "text": "•", "position": [15, 140], "color": "#ffffff", "delay_ms": 1900 },
      { "action": "addLabel", "text": "√16 = 4", "position": [30, 140], "color": "#ffffff", "delay_ms": 2100 },
      { "action": "addLabel", "text": "•", "position": [15, 165], "color": "#ffffff", "delay_ms": 2300 },
      { "action": "addLabel", "text": "x = (-2 ± 4) / 2", "position": [30, 165], "color": "#ffffff", "delay_ms": 2500 },
      { "action": "drawLine", "points": [[15,185],[335,185]], "color": "#81C784", "delay_ms": 2700 },
      { "action": "drawShape", "type": "rectangle", "position": [60, 195], "width": 220, "height": 30, "delay_ms": 2900 },
      { "action": "addLabel", "text": "x = 1  or  x = -3", "position": [110, 204], "color": "#81C784", "delay_ms": 3100 }
    ],
    "checkpoint": null
  },
  {
    "step": 6,
    "voice_script": "Brilliant! Now it is your turn to solve a quadratic equation. Use any method you prefer — factorisation or the formula. Show your working and write both solutions.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "YOUR TURN!", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [40, 55], "width": 260, "height": 45, "delay_ms": 700 },
      { "action": "addLabel", "text": "Solve: x² - 7x + 12 = 0", "position": [75, 72], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "drawLine", "points": [[40,120],[300,120]], "color": "#4FC3F7", "delay_ms": 1300 },
      { "action": "addLabel", "text": "Hint: multiply=+12, add=-7", "position": [70, 140], "color": "#4FC3F7", "delay_ms": 1600 },
      { "action": "addLabel", "text": "Write BOTH values of x", "position": [85, 170], "color": "#ffffff", "delay_ms": 1900 }
    ],
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
]' WHERE id = 'shs-math-quadratic-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SHS Math: Simultaneous Equations (shs-math-simultaneous-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Hello class! Today we are solving simultaneous equations. Imagine you go to a chop bar and you buy 2 plates of rice and 1 cup of soup for 20 cedis. Your friend buys 1 plate of rice and 2 cups of soup for 16 cedis. How much does each item cost separately? That is exactly the kind of problem simultaneous equations solve!",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SIMULTANEOUS EQUATIONS", "position": [70, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 42], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "2 unknowns → need 2 equations", "position": [45, 50], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,85],[335,85]], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Real-life example:", "position": [15, 100], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 120], "color": "#ffffff", "delay_ms": 1400 },
      { "action": "addLabel", "text": "2 rice + 1 soup = GHS 20", "position": [30, 120], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 145], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "addLabel", "text": "1 rice + 2 soup = GHS 16", "position": [30, 145], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "addLabel", "text": "How much is each item?", "position": [80, 175], "color": "#FCD116", "delay_ms": 2200 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "We label the unknowns. Let r equal the price of one plate of rice, and s equal the price of one cup of soup. From the information: 2r plus s equals 20, and r plus 2s equals 16. These are our two equations. Write them down.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SETTING UP EQUATIONS", "position": [80, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 42], "width": 250, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Let r = rice price, s = soup price", "position": [20, 50], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,85],[335,85]], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 95], "width": 280, "height": 30, "delay_ms": 1200 },
      { "action": "addLabel", "text": "Eq (i):   2r + s = 20", "position": [55, 104], "color": "#81C784", "delay_ms": 1500 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 135], "width": 280, "height": 30, "delay_ms": 1700 },
      { "action": "addLabel", "text": "Eq (ii):  r + 2s = 16", "position": [55, 144], "color": "#4FC3F7", "delay_ms": 2000 },
      { "action": "drawLine", "points": [[15,185],[335,185]], "color": "#FCD116", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Now solve using ELIMINATION", "position": [65, 200], "color": "#FCD116", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "We use the elimination method. Multiply equation two by 2: 2r plus 4s equals 32. Now subtract equation one from this: 2r plus 4s minus 2r plus s equals 32 minus 20. The 2r terms cancel! We get 3s equals 12, so s equals 4 Ghana cedis.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "ELIMINATION METHOD", "position": [90, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "•", "position": [15, 48], "color": "#4FC3F7", "delay_ms": 700 },
      { "action": "addLabel", "text": "Multiply (ii) by 2:", "position": [30, 48], "color": "#4FC3F7", "delay_ms": 900 },
      { "action": "addLabel", "text": "2r + 4s = 32", "position": [50, 70], "color": "#ffffff", "delay_ms": 1100 },
      { "action": "addLabel", "text": "•", "position": [15, 95], "color": "#FF5252", "delay_ms": 1300 },
      { "action": "addLabel", "text": "Subtract (i):", "position": [30, 95], "color": "#FF5252", "delay_ms": 1500 },
      { "action": "addLabel", "text": "2r + 4s = 32", "position": [50, 115], "color": "#ffffff", "delay_ms": 1700 },
      { "action": "addLabel", "text": "- (2r + s  = 20)", "position": [50, 135], "color": "#FF5252", "delay_ms": 1900 },
      { "action": "drawLine", "points": [[45,150],[250,150]], "color": "#FCD116", "delay_ms": 2100 },
      { "action": "addLabel", "text": "3s = 12", "position": [80, 165], "color": "#FCD116", "delay_ms": 2300 },
      { "action": "drawShape", "type": "rectangle", "position": [50, 185], "width": 200, "height": 30, "delay_ms": 2500 },
      { "action": "addLabel", "text": "s = 4  (soup = GHS 4)", "position": [70, 194], "color": "#81C784", "delay_ms": 2700 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Now substitute s equals 4 back into equation one. 2r plus 4 equals 20, so 2r equals 16, therefore r equals 8. One plate of rice costs 8 Ghana cedis and one cup of soup costs 4 cedis. Let us verify: 2 times 8 plus 4 equals 20. Correct! And 8 plus 2 times 4 equals 16. Correct!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "SUBSTITUTE & VERIFY", "position": [90, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "Put s=4 into Eq (i):", "position": [15, 48], "color": "#4FC3F7", "delay_ms": 700 },
      { "action": "addLabel", "text": "2r + 4 = 20", "position": [50, 68], "color": "#ffffff", "delay_ms": 900 },
      { "action": "addLabel", "text": "2r = 16  →  r = 8", "position": [50, 88], "color": "#FCD116", "delay_ms": 1100 },
      { "action": "drawLine", "points": [[15,108],[335,108]], "color": "#81C784", "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [40, 115], "width": 260, "height": 30, "delay_ms": 1500 },
      { "action": "addLabel", "text": "Rice = GHS 8,  Soup = GHS 4", "position": [60, 124], "color": "#81C784", "delay_ms": 1700 },
      { "action": "drawLine", "points": [[15,160],[335,160]], "color": "#FCD116", "delay_ms": 1900 },
      { "action": "addLabel", "text": "VERIFY:", "position": [15, 175], "color": "#FCD116", "delay_ms": 2100 },
      { "action": "addLabel", "text": "•", "position": [15, 195], "color": "#81C784", "delay_ms": 2300 },
      { "action": "addLabel", "text": "2(8)+4 = 20 ✓", "position": [30, 195], "color": "#81C784", "delay_ms": 2500 },
      { "action": "addLabel", "text": "•", "position": [15, 218], "color": "#81C784", "delay_ms": 2700 },
      { "action": "addLabel", "text": "8+2(4) = 16 ✓", "position": [30, 218], "color": "#81C784", "delay_ms": 2900 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Fantastic! Now answer this checkpoint to earn your XP.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "CHECKPOINT", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 55], "width": 280, "height": 70, "delay_ms": 700 },
      { "action": "addLabel", "text": "Solve:", "position": [50, 65], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "x + y = 10", "position": [90, 85], "color": "#ffffff", "delay_ms": 1300 },
      { "action": "addLabel", "text": "x - y = 4", "position": [90, 105], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "What is the value of x?", "position": [80, 150], "color": "#FCD116", "delay_ms": 1900 }
    ],
    "checkpoint": {
      "type": "mcq",
      "question": "Solve: x + y = 10 and x - y = 4. What is the value of x?",
      "correct_answer": "7",
      "options": ["3", "5", "7", "6"],
      "hint": "Add the two equations together to eliminate y first.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'shs-math-simultaneous-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SHS Science: The Periodic Table (shs-sci-periodic-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good day future scientists! Today we explore one of the most powerful tools in all of chemistry — the Periodic Table of Elements. Every material in Ghana — the gold we mine at Obuasi, the bauxite at Awaso, the iron ore at Shiene — is made of elements listed in this table.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "THE PERIODIC TABLE", "position": [85, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 42], "width": 310, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "118 known elements, organised by atomic #", "position": [20, 50], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,85],[335,85]], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Ghana''s elements:", "position": [15, 100], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 110], "width": 90, "height": 40, "delay_ms": 1400 },
      { "action": "addLabel", "text": "Au", "position": [45, 118], "color": "#FCD116", "delay_ms": 1600 },
      { "action": "addLabel", "text": "Gold", "position": [35, 138], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "drawShape", "type": "rectangle", "position": [115, 110], "width": 90, "height": 40, "delay_ms": 1800 },
      { "action": "addLabel", "text": "Al", "position": [148, 118], "color": "#4FC3F7", "delay_ms": 2000 },
      { "action": "addLabel", "text": "Aluminium", "position": [120, 138], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "drawShape", "type": "rectangle", "position": [215, 110], "width": 90, "height": 40, "delay_ms": 2200 },
      { "action": "addLabel", "text": "Fe", "position": [248, 118], "color": "#FF5252", "delay_ms": 2400 },
      { "action": "addLabel", "text": "Iron", "position": [240, 138], "color": "#ffffff", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "The periodic table is arranged in PERIODS — horizontal rows — and GROUPS — vertical columns. As you move across a period, the atomic number increases by one each time. The period number tells you how many electron shells an atom of that element has. For example, all elements in Period 3 have 3 electron shells.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "PERIODS & GROUPS", "position": [100, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [60, 50], "width": 50, "height": 35, "delay_ms": 600 },
      { "action": "drawShape", "type": "rectangle", "position": [115, 50], "width": 50, "height": 35, "delay_ms": 600 },
      { "action": "drawShape", "type": "rectangle", "position": [170, 50], "width": 50, "height": 35, "delay_ms": 600 },
      { "action": "drawShape", "type": "rectangle", "position": [225, 50], "width": 50, "height": 35, "delay_ms": 600 },
      { "action": "drawLine", "points": [[55,65],[280,65]], "color": "#4FC3F7", "delay_ms": 900 },
      { "action": "addLabel", "text": "← PERIOD (horizontal row) →", "position": [80, 42], "color": "#4FC3F7", "delay_ms": 1100 },
      { "action": "drawShape", "type": "rectangle", "position": [60, 90], "width": 50, "height": 35, "delay_ms": 1300 },
      { "action": "drawShape", "type": "rectangle", "position": [60, 130], "width": 50, "height": 35, "delay_ms": 1300 },
      { "action": "drawLine", "points": [[85,85],[85,170]], "color": "#81C784", "delay_ms": 1500 },
      { "action": "addLabel", "text": "GROUP", "position": [15, 110], "color": "#81C784", "delay_ms": 1700 },
      { "action": "addLabel", "text": "(vertical", "position": [12, 130], "color": "#81C784", "delay_ms": 1800 },
      { "action": "addLabel", "text": "column)", "position": [15, 148], "color": "#81C784", "delay_ms": 1900 },
      { "action": "drawLine", "points": [[15,185],[335,185]], "color": "#FCD116", "delay_ms": 2100 },
      { "action": "addLabel", "text": "Period # = number of electron shells", "position": [35, 200], "color": "#FCD116", "delay_ms": 2300 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "Group 1 elements are called the Alkali Metals — sodium, potassium, lithium and others. They all have one electron in their outer shell and are very reactive. Group 7 are the Halogens — fluorine, chlorine, bromine — they have 7 outer electrons and also react strongly. Group 0 or 18, the Noble Gases, are completely unreactive — they have full outer shells.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "KEY GROUPS TO KNOW", "position": [85, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 40], "width": 310, "height": 50, "delay_ms": 600 },
      { "action": "addLabel", "text": "Group 1: ALKALI METALS", "position": [20, 48], "color": "#FF5252", "delay_ms": 800 },
      { "action": "addLabel", "text": "Li, Na, K — 1 outer e⁻ — VERY reactive", "position": [20, 70], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 100], "width": 310, "height": 50, "delay_ms": 1200 },
      { "action": "addLabel", "text": "Group 7: HALOGENS", "position": [20, 108], "color": "#FCD116", "delay_ms": 1400 },
      { "action": "addLabel", "text": "F, Cl, Br — 7 outer e⁻ — reactive", "position": [20, 130], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 160], "width": 310, "height": 50, "delay_ms": 1800 },
      { "action": "addLabel", "text": "Group 0: NOBLE GASES", "position": [20, 168], "color": "#4FC3F7", "delay_ms": 2000 },
      { "action": "addLabel", "text": "He, Ne, Ar — FULL shell — unreactive", "position": [20, 190], "color": "#ffffff", "delay_ms": 2200 },
      { "action": "drawLine", "points": [[15,225],[335,225]], "color": "#FCD116", "delay_ms": 2400 },
      { "action": "addLabel", "text": "Reactivity depends on outer electrons!", "position": [35, 240], "color": "#FCD116", "delay_ms": 2600 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "Elements in the same group have SIMILAR chemical properties because they have the same number of outer electrons. This is why the periodic table is so useful — you can predict how an element will behave just by knowing its position. The table was first organised by Dmitri Mendeleev in 1869. He even left gaps for elements not yet discovered!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "WHY THE TABLE WORKS", "position": [85, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 42], "width": 310, "height": 35, "delay_ms": 600 },
      { "action": "addLabel", "text": "Same Group = Same outer e⁻", "position": [45, 50], "color": "#4FC3F7", "delay_ms": 800 },
      { "action": "addLabel", "text": "= SIMILAR chemical properties", "position": [45, 65], "color": "#81C784", "delay_ms": 1000 },
      { "action": "drawLine", "points": [[15,95],[335,95]], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "You can PREDICT behaviour from position!", "position": [20, 110], "color": "#FCD116", "delay_ms": 1400 },
      { "action": "drawLine", "points": [[15,130],[335,130]], "color": "#FCD116", "delay_ms": 1600 },
      { "action": "addLabel", "text": "History:", "position": [15, 148], "color": "#4FC3F7", "delay_ms": 1800 },
      { "action": "drawShape", "type": "rectangle", "position": [15, 160], "width": 310, "height": 40, "delay_ms": 2000 },
      { "action": "addLabel", "text": "Dmitri Mendeleev (1869)", "position": [70, 168], "color": "#FCD116", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Left GAPS for undiscovered elements!", "position": [30, 188], "color": "#81C784", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Excellent progress! Answer this question to lock in your XP.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "CHECKPOINT", "position": [120, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [20, 55], "width": 300, "height": 65, "delay_ms": 700 },
      { "action": "addLabel", "text": "Elements in the same GROUP", "position": [55, 68], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "have similar properties because", "position": [42, 88], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "they have the same number of...", "position": [42, 105], "color": "#FCD116", "delay_ms": 1500 }
    ],
    "checkpoint": {
      "type": "mcq",
      "question": "Elements in the same GROUP of the periodic table have similar properties because they have the same number of:",
      "correct_answer": "Outer electrons",
      "options": ["Protons in the nucleus", "Outer electrons", "Neutrons in the nucleus", "Electron shells"],
      "hint": "Think about what the group number tells us about an element''s electron arrangement.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'shs-sci-periodic-01';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SHS Social Studies: Arms of Government (shs-soc-government-01)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ec_lessons SET content_json = '[
  {
    "step": 1,
    "voice_script": "Good morning, class! Today we are studying the three arms of government in Ghana. A well-functioning democracy needs a clear separation of power. No single person or body should control everything — not even the President. Ghana learned this lesson through many years of military coups and democratic struggles.",
    "board_actions": [
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "addLabel", "text": "ARMS OF GOVERNMENT IN GHANA", "position": [45, 12], "color": "#006B3F", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [30, 45], "width": 280, "height": 30, "delay_ms": 600 },
      { "action": "addLabel", "text": "SEPARATION OF POWERS", "position": [80, 54], "color": "#FCD116", "delay_ms": 800 },
      { "action": "drawLine", "points": [[15,90],[335,90]], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "Why?", "position": [15, 105], "color": "#FCD116", "delay_ms": 1200 },
      { "action": "addLabel", "text": "•", "position": [15, 125], "color": "#ffffff", "delay_ms": 1400 },
      { "action": "addLabel", "text": "Prevents abuse of power", "position": [30, 125], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 150], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Protects citizens'' rights", "position": [30, 150], "color": "#ffffff", "delay_ms": 2000 },
      { "action": "addLabel", "text": "•", "position": [15, 175], "color": "#ffffff", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Lesson from military coups", "position": [30, 175], "color": "#FF5252", "delay_ms": 2400 }
    ],
    "checkpoint": null
  },
  {
    "step": 2,
    "voice_script": "The EXECUTIVE arm is responsible for running the country day-to-day. In Ghana, the Executive is headed by the President, who is both head of state and head of government. The President appoints ministers who head the various ministries — like the Ministry of Education, the Ministry of Health, and so on. The President serves a maximum of two four-year terms.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "addLabel", "text": "ARM 1: THE EXECUTIVE", "position": [80, 12], "color": "#FCD116", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#FCD116", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [100, 45], "width": 140, "height": 35, "delay_ms": 600 },
      { "action": "addLabel", "text": "THE PRESIDENT", "position": [115, 56], "color": "#FCD116", "delay_ms": 800 },
      { "action": "drawLine", "points": [[170,80],[170,100]], "color": "#FCD116", "delay_ms": 1000 },
      { "action": "addLabel", "text": "appoints", "position": [180, 90], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [100, 105], "width": 140, "height": 25, "delay_ms": 1200 },
      { "action": "addLabel", "text": "MINISTERS", "position": [135, 112], "color": "#4FC3F7", "delay_ms": 1400 },
      { "action": "drawLine", "points": [[15,145],[335,145]], "color": "#ffffff", "delay_ms": 1600 },
      { "action": "addLabel", "text": "•", "position": [15, 160], "color": "#81C784", "delay_ms": 1800 },
      { "action": "addLabel", "text": "Head of State + Head of Government", "position": [30, 160], "color": "#81C784", "delay_ms": 2000 },
      { "action": "addLabel", "text": "•", "position": [15, 185], "color": "#81C784", "delay_ms": 2200 },
      { "action": "addLabel", "text": "Runs the country day-to-day", "position": [30, 185], "color": "#81C784", "delay_ms": 2400 },
      { "action": "addLabel", "text": "•", "position": [15, 210], "color": "#4FC3F7", "delay_ms": 2600 },
      { "action": "addLabel", "text": "Max term: 2 x 4 years = 8 years", "position": [30, 210], "color": "#4FC3F7", "delay_ms": 2800 }
    ],
    "checkpoint": null
  },
  {
    "step": 3,
    "voice_script": "The LEGISLATURE is Parliament. Ghana has a unicameral parliament — meaning one house with 275 members of parliament elected from constituencies across the country. Parliament''s job is to make and amend laws, approve the national budget, and hold the executive accountable. Our Parliament is located in Accra, near the Jubilee House.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#81C784", "delay_ms": 300 },
      { "action": "addLabel", "text": "ARM 2: THE LEGISLATURE", "position": [75, 12], "color": "#81C784", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#81C784", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [60, 42], "width": 220, "height": 30, "delay_ms": 600 },
      { "action": "addLabel", "text": "PARLIAMENT (275 MPs)", "position": [85, 51], "color": "#81C784", "delay_ms": 800 },
      { "action": "addLabel", "text": "Unicameral = one house", "position": [90, 85], "color": "#4FC3F7", "delay_ms": 1000 },
      { "action": "drawLine", "points": [[15,100],[335,100]], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "Roles:", "position": [15, 115], "color": "#FCD116", "delay_ms": 1400 },
      { "action": "addLabel", "text": "•", "position": [15, 135], "color": "#81C784", "delay_ms": 1600 },
      { "action": "addLabel", "text": "Makes and amends laws", "position": [30, 135], "color": "#81C784", "delay_ms": 1800 },
      { "action": "addLabel", "text": "•", "position": [15, 158], "color": "#81C784", "delay_ms": 2000 },
      { "action": "addLabel", "text": "Approves the national budget", "position": [30, 158], "color": "#81C784", "delay_ms": 2200 },
      { "action": "addLabel", "text": "•", "position": [15, 181], "color": "#81C784", "delay_ms": 2400 },
      { "action": "addLabel", "text": "Holds the Executive accountable", "position": [30, 181], "color": "#81C784", "delay_ms": 2600 },
      { "action": "drawLine", "points": [[15,200],[335,200]], "color": "#4FC3F7", "delay_ms": 2800 },
      { "action": "addLabel", "text": "Located in Accra, near Jubilee House", "position": [40, 215], "color": "#4FC3F7", "delay_ms": 3000 }
    ],
    "checkpoint": null
  },
  {
    "step": 4,
    "voice_script": "The JUDICIARY interprets and applies the law. It is headed by the Chief Justice and includes the Supreme Court, the Court of Appeal, the High Court, and the lower courts. The judiciary is independent — judges cannot be told by the President or Parliament what verdicts to deliver. This independence protects the rights of ordinary Ghanaians.",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#4FC3F7", "delay_ms": 300 },
      { "action": "addLabel", "text": "ARM 3: THE JUDICIARY", "position": [85, 12], "color": "#4FC3F7", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#4FC3F7", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [80, 42], "width": 180, "height": 28, "delay_ms": 600 },
      { "action": "addLabel", "text": "Head: CHIEF JUSTICE", "position": [95, 50], "color": "#FCD116", "delay_ms": 800 },
      { "action": "addLabel", "text": "Court Hierarchy:", "position": [15, 85], "color": "#4FC3F7", "delay_ms": 1000 },
      { "action": "drawShape", "type": "rectangle", "position": [90, 95], "width": 160, "height": 22, "delay_ms": 1200 },
      { "action": "addLabel", "text": "Supreme Court", "position": [120, 100], "color": "#FCD116", "delay_ms": 1400 },
      { "action": "drawLine", "points": [[170,117],[170,125]], "color": "#ffffff", "delay_ms": 1500 },
      { "action": "drawShape", "type": "rectangle", "position": [90, 125], "width": 160, "height": 22, "delay_ms": 1600 },
      { "action": "addLabel", "text": "Court of Appeal", "position": [115, 130], "color": "#ffffff", "delay_ms": 1800 },
      { "action": "drawLine", "points": [[170,147],[170,155]], "color": "#ffffff", "delay_ms": 1900 },
      { "action": "drawShape", "type": "rectangle", "position": [90, 155], "width": 160, "height": 22, "delay_ms": 2000 },
      { "action": "addLabel", "text": "High Court", "position": [130, 160], "color": "#ffffff", "delay_ms": 2200 },
      { "action": "drawLine", "points": [[170,177],[170,185]], "color": "#ffffff", "delay_ms": 2300 },
      { "action": "addLabel", "text": "Lower Courts...", "position": [125, 192], "color": "#ffffff", "delay_ms": 2400 },
      { "action": "drawLine", "points": [[15,210],[335,210]], "color": "#FF5252", "delay_ms": 2600 },
      { "action": "addLabel", "text": "INDEPENDENT — no interference!", "position": [55, 225], "color": "#FF5252", "delay_ms": 2800 }
    ],
    "checkpoint": null
  },
  {
    "step": 5,
    "voice_script": "Wonderful! The three arms — Executive, Legislature, Judiciary — each check and balance the others. This is what makes Ghana a constitutional democracy. Now test yourself!",
    "board_actions": [
      { "action": "clearBoard", "delay_ms": 0 },
      { "action": "drawLine", "points": [[10,5],[340,5]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "addLabel", "text": "QUIZ TIME!", "position": [125, 12], "color": "#006B3F", "delay_ms": 500 },
      { "action": "drawLine", "points": [[10,28],[340,28]], "color": "#006B3F", "delay_ms": 300 },
      { "action": "drawShape", "type": "rectangle", "position": [20, 55], "width": 300, "height": 65, "delay_ms": 700 },
      { "action": "addLabel", "text": "Which arm of government", "position": [65, 68], "color": "#ffffff", "delay_ms": 1000 },
      { "action": "addLabel", "text": "can declare a law", "position": [85, 88], "color": "#ffffff", "delay_ms": 1200 },
      { "action": "addLabel", "text": "UNCONSTITUTIONAL?", "position": [85, 108], "color": "#FCD116", "delay_ms": 1500 }
    ],
    "checkpoint": {
      "type": "mcq",
      "question": "Which arm of government in Ghana has the power to declare a law unconstitutional?",
      "correct_answer": "The Judiciary",
      "options": ["The Executive (President)", "The Legislature (Parliament)", "The Judiciary", "The Electoral Commission"],
      "hint": "This arm interprets the constitution and can strike down laws that violate it.",
      "xp_reward": 50
    }
  }
]' WHERE id = 'shs-soc-government-01';
