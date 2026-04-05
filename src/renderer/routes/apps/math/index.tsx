import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'

interface PostMessage {
  type: string
  toolName?: string
  params?: Record<string, unknown>
  invocationId?: string
  result?: Record<string, unknown>
}

interface Problem {
  question: string
  answer: number
  hint: string
}

interface QuizState {
  topic: string
  difficulty: number
  problems: Problem[]
  currentIndex: number
  score: number
  answers: Map<number, { given: string; correct: boolean }>
  completed: boolean
}

function generateProblems(topic: string, difficulty: number, count: number): Problem[] {
  const problems: Problem[] = []
  const maxVal = [10, 20, 50, 100, 200][Math.min(difficulty - 1, 4)]

  for (let i = 0; i < count; i++) {
    let a: number, b: number, answer: number, question: string, hint: string
    const effectiveTopic = topic === 'mixed' ? ['addition', 'subtraction', 'multiplication', 'division'][Math.floor(Math.random() * 4)] : topic

    switch (effectiveTopic) {
      case 'addition':
        a = Math.floor(Math.random() * maxVal) + 1
        b = Math.floor(Math.random() * maxVal) + 1
        answer = a + b
        question = `${a} + ${b} = ?`
        hint = `Try counting up from ${a} by ${b}.`
        break
      case 'subtraction':
        a = Math.floor(Math.random() * maxVal) + Math.floor(maxVal / 2)
        b = Math.floor(Math.random() * Math.min(a, maxVal)) + 1
        answer = a - b
        question = `${a} - ${b} = ?`
        hint = `Start at ${a} and count backwards by ${b}.`
        break
      case 'multiplication':
        a = Math.floor(Math.random() * Math.min(maxVal, 12)) + 1
        b = Math.floor(Math.random() * Math.min(maxVal, 12)) + 1
        answer = a * b
        question = `${a} x ${b} = ?`
        hint = `Think of ${a} groups of ${b}.`
        break
      case 'division':
        b = Math.floor(Math.random() * Math.min(maxVal, 12)) + 1
        answer = Math.floor(Math.random() * Math.min(maxVal, 12)) + 1
        a = b * answer
        question = `${a} / ${b} = ?`
        hint = `How many groups of ${b} fit into ${a}?`
        break
      case 'fractions': {
        const denom = [2, 3, 4, 5, 6, 8, 10][Math.floor(Math.random() * 7)]
        const num1 = Math.floor(Math.random() * (denom - 1)) + 1
        const num2 = Math.floor(Math.random() * (denom - 1)) + 1
        answer = num1 + num2
        question = `${num1}/${denom} + ${num2}/${denom} = ?/${denom}`
        hint = `When denominators are the same, just add the numerators: ${num1} + ${num2}.`
        break
      }
      default:
        a = Math.floor(Math.random() * maxVal) + 1
        b = Math.floor(Math.random() * maxVal) + 1
        answer = a + b
        question = `${a} + ${b} = ?`
        hint = `Try breaking it into parts.`
    }
    problems.push({ question, answer, hint })
  }
  return problems
}

export const Route = createFileRoute('/apps/math/')({
  component: MathQuizApp,
})

function MathQuizApp() {
  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [userInput, setUserInput] = useState('')
  const [feedback, setFeedback] = useState<{ correct: boolean; message: string } | null>(null)
  const [showHint, setShowHint] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const sendToParent = useCallback((msg: PostMessage) => {
    if (window.parent !== window) {
      window.parent.postMessage(msg, window.location.origin)
    }
  }, [])

  const getScoreData = useCallback((q: QuizState) => ({
    topic: q.topic,
    difficulty: q.difficulty,
    totalProblems: q.problems.length,
    answered: q.answers.size,
    correct: q.score,
    incorrect: q.answers.size - q.score,
    remaining: q.problems.length - q.answers.size,
    currentProblem: q.currentIndex + 1,
    percentCorrect: q.answers.size > 0 ? Math.round((q.score / q.answers.size) * 100) : 0,
  }), [])

  const advanceToNext = useCallback((q: QuizState): QuizState => {
    if (q.currentIndex + 1 >= q.problems.length) {
      return { ...q, completed: true }
    }
    return { ...q, currentIndex: q.currentIndex + 1 }
  }, [])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const msg = event.data as PostMessage
      if (msg.type !== 'TOOL_INVOKE') return

      const { toolName, params, invocationId } = msg

      switch (toolName) {
        case 'start_quiz': {
          const topic = (params?.topic as string) || 'addition'
          const difficulty = Math.min(5, Math.max(1, (params?.difficulty as number) || 3))
          const count = Math.min(20, Math.max(3, (params?.count as number) || 10))
          const problems = generateProblems(topic, difficulty, count)
          const newQuiz: QuizState = {
            topic,
            difficulty,
            problems,
            currentIndex: 0,
            score: 0,
            answers: new Map(),
            completed: false,
          }
          setQuiz(newQuiz)
          setFeedback(null)
          setShowHint(false)
          setUserInput('')
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              topic,
              difficulty,
              totalProblems: count,
              firstProblem: problems[0].question,
              status: 'quiz_started',
              instruction: 'Math quiz started! The student can answer in the UI or through chat. They can also ask for hints.',
            },
          })
          break
        }
        case 'submit_answer': {
          if (!quiz) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active quiz.' } })
            return
          }
          const given = String(params?.answer || '').trim()
          const problem = quiz.problems[quiz.currentIndex]
          const correct = parseInt(given, 10) === problem.answer

          const newAnswers = new Map(quiz.answers)
          newAnswers.set(quiz.currentIndex, { given, correct })
          const newScore = quiz.score + (correct ? 1 : 0)
          let updatedQuiz = { ...quiz, answers: newAnswers, score: newScore }
          updatedQuiz = advanceToNext(updatedQuiz)
          setQuiz(updatedQuiz)
          setFeedback({ correct, message: correct ? 'Correct!' : `Not quite. The answer was ${problem.answer}.` })
          setShowHint(false)
          setUserInput('')

          if (updatedQuiz.completed) {
            const scoreData = getScoreData(updatedQuiz)
            sendToParent({
              type: 'TOOL_RESULT',
              invocationId,
              result: {
                ...scoreData,
                wasCorrect: correct,
                givenAnswer: given,
                correctAnswer: problem.answer,
                feedback: correct ? 'Correct!' : `Incorrect. The answer was ${problem.answer}.`,
                quizComplete: true,
              },
            })
            sendToParent({
              type: 'APP_COMPLETE',
              result: scoreData,
            })
          } else {
            const scoreData = getScoreData(updatedQuiz)
            sendToParent({
              type: 'TOOL_RESULT',
              invocationId,
              result: {
                ...scoreData,
                wasCorrect: correct,
                givenAnswer: given,
                correctAnswer: problem.answer,
                feedback: correct ? 'Correct!' : `Incorrect. The answer was ${problem.answer}.`,
                nextProblem: updatedQuiz.problems[updatedQuiz.currentIndex].question,
              },
            })
          }
          break
        }
        case 'get_hint': {
          if (!quiz) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active quiz.' } })
            return
          }
          setShowHint(true)
          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              problem: quiz.problems[quiz.currentIndex].question,
              hint: quiz.problems[quiz.currentIndex].hint,
            },
          })
          break
        }
        case 'skip_problem': {
          if (!quiz) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active quiz.' } })
            return
          }
          const problem = quiz.problems[quiz.currentIndex]
          const newAnswers = new Map(quiz.answers)
          newAnswers.set(quiz.currentIndex, { given: 'skipped', correct: false })
          let updatedQuiz = { ...quiz, answers: newAnswers }
          updatedQuiz = advanceToNext(updatedQuiz)
          setQuiz(updatedQuiz)
          setFeedback({ correct: false, message: `Skipped. The answer was ${problem.answer}.` })
          setShowHint(false)
          setUserInput('')

          sendToParent({
            type: 'TOOL_RESULT',
            invocationId,
            result: {
              skipped: true,
              correctAnswer: problem.answer,
              quizComplete: updatedQuiz.completed,
              ...(updatedQuiz.completed ? {} : { nextProblem: updatedQuiz.problems[updatedQuiz.currentIndex].question }),
              ...getScoreData(updatedQuiz),
            },
          })
          if (updatedQuiz.completed) {
            sendToParent({ type: 'APP_COMPLETE', result: getScoreData(updatedQuiz) })
          }
          break
        }
        case 'get_score': {
          if (!quiz) {
            sendToParent({ type: 'TOOL_RESULT', invocationId, result: { error: 'No active quiz.' } })
            return
          }
          sendToParent({ type: 'TOOL_RESULT', invocationId, result: getScoreData(quiz) })
          break
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [quiz, sendToParent, getScoreData, advanceToNext])

  useEffect(() => {
    sendToParent({ type: 'READY' })
  }, [sendToParent])

  // UI submit handler — sends USER_ACTION to parent for bidirectional communication
  const handleSubmitAnswer = () => {
    if (!quiz || !userInput.trim() || quiz.completed) return
    const given = userInput.trim()
    const problem = quiz.problems[quiz.currentIndex]
    const correct = parseInt(given, 10) === problem.answer

    const newAnswers = new Map(quiz.answers)
    newAnswers.set(quiz.currentIndex, { given, correct })
    const newScore = quiz.score + (correct ? 1 : 0)
    let updatedQuiz = { ...quiz, answers: newAnswers, score: newScore }

    setFeedback({ correct, message: correct ? 'Correct!' : `Not quite. The answer is ${problem.answer}.` })
    setShowHint(false)
    setUserInput('')

    // Delay advancing to show feedback
    setTimeout(() => {
      updatedQuiz = advanceToNext(updatedQuiz)
      setQuiz(updatedQuiz)
      setFeedback(null)

      if (updatedQuiz.completed) {
        sendToParent({
          type: 'USER_ACTION',
          result: {
            action: 'quiz_complete',
            ...getScoreData(updatedQuiz),
          },
        })
        sendToParent({ type: 'APP_COMPLETE', result: getScoreData(updatedQuiz) })
      } else {
        sendToParent({
          type: 'USER_ACTION',
          result: {
            action: 'answer_submitted',
            problem: problem.question,
            givenAnswer: given,
            correct,
            correctAnswer: problem.answer,
            score: newScore,
            nextProblem: updatedQuiz.problems[updatedQuiz.currentIndex].question,
            remaining: updatedQuiz.problems.length - updatedQuiz.answers.size,
          },
        })
      }
    }, 1500)

    setQuiz({ ...quiz, answers: newAnswers, score: newScore })
  }

  const handleRestart = () => {
    if (!quiz) return
    const problems = generateProblems(quiz.topic, quiz.difficulty, quiz.problems.length)
    setQuiz({
      topic: quiz.topic,
      difficulty: quiz.difficulty,
      problems,
      currentIndex: 0,
      score: 0,
      answers: new Map(),
      completed: false,
    })
    setFeedback(null)
    setShowHint(false)
    setUserInput('')
    sendToParent({
      type: 'USER_ACTION',
      result: { action: 'restart_quiz', topic: quiz.topic, difficulty: quiz.difficulty },
    })
  }

  // Render: no quiz
  if (!quiz) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-6">
        <div className="text-6xl mb-4">🧮</div>
        <h2 className="text-xl font-bold text-white mb-2">Math Quiz</h2>
        <p className="text-sm text-zinc-400 text-center">
          Ask the chatbot to start a math quiz!
          <br />
          Try: &quot;Give me a multiplication quiz&quot; or &quot;Practice fractions&quot;
        </p>
      </div>
    )
  }

  // Render: completed
  if (quiz.completed) {
    const pct = quiz.answers.size > 0 ? Math.round((quiz.score / quiz.answers.size) * 100) : 0
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-6">
        <div className="text-6xl mb-4">{pct >= 80 ? '🌟' : pct >= 50 ? '👏' : '📖'}</div>
        <h2 className="text-xl font-bold text-white mb-2">Quiz Complete!</h2>
        <p className="text-lg text-zinc-300 capitalize mb-1">{quiz.topic} &middot; Level {quiz.difficulty}</p>
        <div className="flex gap-6 mt-4 mb-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-400">{quiz.score}</p>
            <p className="text-xs text-zinc-500">Correct</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-400">{quiz.answers.size - quiz.score}</p>
            <p className="text-xs text-zinc-500">Incorrect</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-400">{pct}%</p>
            <p className="text-xs text-zinc-500">Score</p>
          </div>
        </div>
        {/* Review missed */}
        {quiz.answers.size - quiz.score > 0 && (
          <div className="w-full max-w-sm mb-4">
            <p className="text-sm text-zinc-400 mb-2">Review missed problems:</p>
            <div className="space-y-1">
              {Array.from(quiz.answers.entries())
                .filter(([, a]) => !a.correct)
                .map(([idx]) => (
                  <div key={idx} className="bg-zinc-800 rounded px-3 py-2 text-sm border border-zinc-700">
                    <span className="text-zinc-300">{quiz.problems[idx].question}</span>
                    <span className="text-green-400 ml-2">= {quiz.problems[idx].answer}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={handleRestart}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  // Render: active quiz
  const problem = quiz.problems[quiz.currentIndex]
  const progressPct = Math.round((quiz.answers.size / quiz.problems.length) * 100)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-900 p-4">
      {/* Header */}
      <div className="w-full max-w-sm mb-4">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">{quiz.topic} &middot; Level {quiz.difficulty}</h2>
          <span className="text-sm text-zinc-500">
            {quiz.currentIndex + 1}/{quiz.problems.length}
          </span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
          <span>{quiz.score} correct</span>
          <span>{quiz.answers.size - quiz.score} incorrect</span>
        </div>
      </div>

      {/* Problem display */}
      <div className="w-full max-w-sm bg-zinc-800 rounded-xl border-2 border-zinc-600 p-8 mb-4">
        <p className="text-3xl font-mono text-white text-center tracking-wider">{problem.question}</p>
        {showHint && (
          <p className="text-sm text-yellow-400 text-center mt-4 bg-yellow-900/20 rounded-lg px-3 py-2 border border-yellow-800">
            💡 {problem.hint}
          </p>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`w-full max-w-sm mb-3 px-4 py-2 rounded-lg text-center text-sm font-medium ${
            feedback.correct ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-red-900/30 text-red-400 border border-red-700'
          }`}
        >
          {feedback.correct ? '✓' : '✗'} {feedback.message}
        </div>
      )}

      {/* Input */}
      <div className="w-full max-w-sm flex gap-2">
        <input
          ref={inputRef}
          type="number"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmitAnswer()}
          placeholder="Your answer..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white text-lg text-center placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          disabled={!!feedback}
        />
        <button
          type="button"
          onClick={handleSubmitAnswer}
          disabled={!userInput.trim() || !!feedback}
          className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          Check
        </button>
      </div>

      {/* Hint & Skip buttons */}
      <div className="flex gap-4 mt-3">
        <button
          type="button"
          onClick={() => setShowHint(true)}
          disabled={showHint || !!feedback}
          className="text-xs text-yellow-500 hover:text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          💡 Hint
        </button>
        <button
          type="button"
          onClick={() => {
            const newAnswers = new Map(quiz.answers)
            newAnswers.set(quiz.currentIndex, { given: 'skipped', correct: false })
            let updatedQuiz = { ...quiz, answers: newAnswers }
            updatedQuiz = advanceToNext(updatedQuiz)
            setQuiz(updatedQuiz)
            setFeedback(null)
            setShowHint(false)
            setUserInput('')
            sendToParent({
              type: 'USER_ACTION',
              result: {
                action: 'skipped_problem',
                problem: problem.question,
                correctAnswer: problem.answer,
                remaining: updatedQuiz.problems.length - updatedQuiz.answers.size,
              },
            })
            if (updatedQuiz.completed) {
              sendToParent({ type: 'APP_COMPLETE', result: getScoreData(updatedQuiz) })
            }
          }}
          disabled={!!feedback}
          className="text-xs text-zinc-500 hover:text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Skip &rarr;
        </button>
      </div>
    </div>
  )
}
