const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Các hàm thuật toán dự đoán của bạn
let modelPredictions = {};

function detectStreakAndBreak(history) {
    if (!history || history.length === 0) {
        return { 'streak': 0, 'currentResult': null, 'breakProb': 0 };
    }
    
    let streak = 1;
    const currentResult = history[history.length - 1]['ket_qua'];
    
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i]['ket_qua'] === currentResult) {
            streak++;
        } else {
            break;
        }
    }
    
    const recentResults = history.slice(-15).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return { 'streak': streak, 'currentResult': currentResult, 'breakProb': 0 };
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    const taiCount = recentResults.filter(result => result === 'Tài').length;
    const xiuCount = recentResults.filter(result => result === 'Xỉu').length;
    const balance = Math.abs(taiCount - xiuCount) / recentResults.length;
    
    let breakProb = 0;
    if (streak >= 8) {
        breakProb = Math.min(0.6 + switches / 15 + balance * 0.15, 0.9);
    } else if (streak >= 5) {
        breakProb = Math.min(0.35 + switches / 10 + balance * 0.25, 0.85);
    } else if (streak >= 3 && switches >= 7) {
        breakProb = 0.3;
    }
    
    return { 'streak': streak, 'currentResult': currentResult, 'breakProb': breakProb };
}

function evaluateModelPerformance(history, modelName, rounds = 10) {
    if (!modelPredictions[modelName] || history.length < 2) {
        return 1;
    }
    
    rounds = Math.min(rounds, history.length - 1);
    let correctPredictions = 0;
    
    for (let i = 0; i < rounds; i++) {
        const prediction = modelPredictions[modelName][history[history.length - (i + 2)].phien] || 0;
        const actualResult = history[history.length - (i + 1)].ket_qua;
        
        if ((prediction === 1 && actualResult === 'Xỉu') || (prediction === 2 && actualResult === 'Tài')) {
            correctPredictions++;
        }
    }
    
    const accuracyScore = rounds > 0 ? 1 + (correctPredictions - rounds / 2) / (rounds / 2) : 1;
    return Math.min(1.5, Math.max(0.5, accuracyScore));
}

function smartBridgeBreak(history) {
    if (!history || history.length < 3) {
        return { 'prediction': 0, 'breakProb': 0, 'reason': 'Không đủ dữ liệu để bẻ cầu' };
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    const recentResults = history.slice(-20).map(entry => entry.ket_qua);
    const recentScores = history.slice(-20).map(entry => entry.tong || 0);
    
    let prob = breakProb;
    let reason = '';
    
    const meanScore = recentScores.reduce((sum, score) => sum + score, 0) / (recentScores.length || 1);
    const meanDeviation = recentScores.reduce((sum, score) => sum + Math.abs(score - meanScore), 0) / (recentScores.length || 1);
    
    const recentFive = recentResults.slice(-5);
    const patterns = {};
    for (let i = 0; i <= recentResults.length - 3; i++) {
        const pattern = recentResults.slice(i, i + 3).join(',');
        patterns[pattern] = (patterns[pattern] || 0) + 1;
    }
    
    const mostFrequentPattern = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0];
    const isRepeatingPattern = mostFrequentPattern && mostFrequentPattern[1] >= 3;
    
    if (streak >= 6) {
        prob = Math.min(prob + 0.15, 0.9);
        reason = '[Bẻ Cầu] Chuỗi ' + streak + ' ' + currentResult + ' dài, khả năng bẻ cầu cao';
    } else if (streak >= 4 && meanDeviation > 3) {
        prob = Math.min(prob + 0.1, 0.85);
        reason = '[Bẻ Cầu] Biến động điểm số lớn (' + meanDeviation.toFixed(1) + '), khả năng bẻ cầu tăng';
    } else if (isRepeatingPattern && recentFive.every(result => result === currentResult)) {
        prob = Math.min(prob + 0.05, 0.8);
        reason = '[Bẻ Cầu] Phát hiện mẫu lặp ' + mostFrequentPattern[0] + ', có khả năng bẻ cầu';
    } else {
        prob = Math.max(prob - 0.15, 0.15);
        reason = '[Bẻ Cầu] Không phát hiện mẫu bẻ cầu mạnh, tiếp tục theo cầu';
    }
    
    let prediction = prob > 0.65 ? (currentResult === 'Tài' ? 1 : 2) : (currentResult === 'Tài' ? 2 : 1);
    
    return { 'prediction': prediction, 'breakProb': prob, 'reason': reason };
}

function trendAndProb(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 5) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-15).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return 0;
    }
    
    const weights = recentResults.map((_, index) => Math.pow(1.2, index));
    const taiScore = weights.reduce((sum, weight, index) => sum + (recentResults[index] === 'Tài' ? weight : 0), 0);
    const xiuScore = weights.reduce((sum, weight, index) => sum + (recentResults[index] === 'Xỉu' ? weight : 0), 0);
    const totalScore = taiScore + xiuScore;
    
    const recentTen = history.slice(-10).map(entry => entry.ket_qua);
    const patterns = [];
    if (recentTen.length >= 4) {
        for (let i = 0; i <= recentTen.length - 4; i++) {
            patterns.push(recentTen.slice(i, i + 4).join(','));
        }
    }
    
    const patternCounts = patterns.reduce((counts, pattern) => {
        counts[pattern] = (counts[pattern] || 0) + 1;
        return counts;
    }, {});
    
    const mostFrequentPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPattern && mostFrequentPattern[1] >= 3) {
        const patternResults = mostFrequentPattern[0].split(',');
        return patternResults[patternResults.length - 1] !== recentTen[recentTen.length - 1] ? 2 : 1;
    } else if (totalScore > 0 && Math.abs(taiScore - xiuScore) / totalScore >= 0.25) {
        return taiScore > xiuScore ? 2 : 1;
    }
    
    return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
}

function shortPattern(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-8).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return 0;
    }
    
    const patterns = [];
    if (recentResults.length >= 3) {
        for (let i = 0; i <= recentResults.length - 3; i++) {
            patterns.push(recentResults.slice(i, i + 3).join(','));
        }
    }
    
    const patternCounts = patterns.reduce((counts, pattern) => {
        counts[pattern] = (counts[pattern] || 0) + 1;
        return counts;
    }, {});
    
    const mostFrequentPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPattern && mostFrequentPattern[1] >= 2) {
        const patternResults = mostFrequentPattern[0].split(',');
        return patternResults[patternResults.length - 1] !== recentResults[recentResults.length - 1] ? 2 : 1;
    }
    
    return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
}

function meanDeviation(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-12).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return 0;
    }
    
    const taiCount = recentResults.filter(result => result === 'Tài').length;
    const xiuCount = recentResults.length - taiCount;
    const balance = Math.abs(taiCount - xiuCount) / recentResults.length;
    
    if (balance < 0.35) {
        return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
    }
    
    return xiuCount > taiCount ? 2 : 1;
}

function recentSwitch(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-10).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return 0;
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    
    return switches >= 6 ? (recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1) : (recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1);
}

function isBadPattern(history) {
    if (!history || history.length < 3) {
        return false;
    }
    
    const recentResults = history.slice(-15).map(entry => entry.ket_qua);
    if (!recentResults.length) {
        return false;
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    const { streak } = detectStreakAndBreak(history);
    
    return switches >= 9 || streak >= 10;
}

function vannhatLogic(history) {
    if (!history || history.length < 3) {
        const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        return { 'prediction': randomResult, 'reason': '[AI] Không đủ lịch sử, dự đoán ngẫu nhiên', 'source': 'AI VANNhat - Tele@CsTool001' };
    }
    
    const recentFive = history.slice(-5).map(entry => entry.ket_qua);
    const recentFiveScores = history.slice(-5).map(entry => entry.tong || 0);
    const taiCount = recentFive.filter(result => result === 'Tài').length;
    const xiuCount = recentFive.filter(result => result === 'Xỉu').length;
    
    if (history.length >= 3) {
        const recentThree = history.slice(-3).map(entry => entry.ket_qua);
        if (recentThree.join(',') === 'Tài,Xỉu,Tài') {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Phát hiện mẫu 1T1X → tiếp theo nên đánh Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
        } else if (recentThree.join(',') === 'Xỉu,Tài,Xỉu') {
            return { 'prediction': 'Tài', 'reason': '[AI] Phát hiện mẫu 1X1T → tiếp theo nên đánh Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
        }
    }
    
    if (history.length >= 4) {
        const recentFour = history.slice(-4).map(entry => entry.ket_qua);
        if (recentFour.join(',') === 'Tài,Tài,Xỉu,Xỉu') {
            return { 'prediction': 'Tài', 'reason': '[AI] Phát hiện mẫu 2T2X → tiếp theo nên đánh Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
        } else if (recentFour.join(',') === 'Xỉu,Xỉu,Tài,Tài') {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Phát hiện mẫu 2X2T → tiếp theo nên đánh Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
        }
    }
    
    if (history.length >= 9 && history.slice(-6).every(entry => entry.ket_qua === 'Tài')) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Chuỗi Tài quá dài (6 lần) → dự đoán Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
    } else if (history.length >= 9 && history.slice(-6).every(entry => entry.ket_qua === 'Xỉu')) {
        return { 'prediction': 'Tài', 'reason': '[AI] Chuỗi Xỉu quá dài (6 lần) → dự đoán Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
    }
    
    const averageScore = recentFiveScores.reduce((sum, score) => sum + score, 0) / (recentFiveScores.length || 1);
    if (averageScore > 10) {
        return { 'prediction': 'Tài', 'reason': '[AI] Điểm trung bình cao (' + averageScore.toFixed(1) + ') → dự đoán Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
    } else if (averageScore < 8) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Điểm trung bình thấp (' + averageScore.toFixed(1) + ') → dự đoán Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
    }
    
    if (taiCount > xiuCount + 1) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Tài chiếm đa số (' + taiCount + '/' + recentFive.length + ') → dự đoán Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
    } else if (xiuCount > taiCount + 1) {
        return { 'prediction': 'Tài', 'reason': '[AI] Xỉu chiếm đa số (' + xiuCount + '/' + recentFive.length + ') → dự đoán Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
    } else {
        const totalTai = history.filter(entry => entry.ket_qua === 'Tài').length;
        const totalXiu = history.filter(entry => entry.ket_qua === 'Xỉu').length;
        
        if (totalTai > totalXiu + 2) {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Tổng thể Tài nhiều hơn → dự đoán Xỉu', 'source': 'AI VANNhat - Tele@CsTool001' };
        } else if (totalXiu > totalTai + 2) {
            return { 'prediction': 'Tài', 'reason': '[AI] Tổng thể Xỉu nhiều hơn → dự đoán Tài', 'source': 'AI VANNhat - Tele@CsTool001' };
        } else {
            const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
            return { 'prediction': randomResult, 'reason': '[AI] Cân bằng, dự đoán ngẫu nhiên', 'source': 'AI VANNhat - Tele@CsTool001' };
        }
    }
}

function generatePrediction(history, storedPredictions) {
    modelPredictions = storedPredictions;
    if (!history || history.length === 0) {
        console.log('No history available, generating random prediction');
        const randomPrediction = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        console.log('Random Prediction:', randomPrediction);
        return { prediction: randomPrediction, confidence: 0.5, reason: 'Không có dữ liệu, dự đoán ngẫu nhiên' };
    }
    
    if (!modelPredictions['trend']) {
        modelPredictions = {
            'trend': {},
            'short': {},
            'mean': {},
            'switch': {},
            'bridge': {}
        };
    }
    
    const lastSession = history[history.length - 1].phien;
    
    const trendPrediction = history.length < 5 ? (history[history.length - 1].ket_qua === 'Tài' ? 2 : 1) : trendAndProb(history);
    const shortPrediction = history.length < 5 ? (history[history.length - 1].ket_qua === 'Tài' ? 2 : 1) : shortPattern(history);
    const meanPrediction = history.length < 5 ? (history[history.length - 1].ket_qua === 'Tài' ? 2 : 1) : meanDeviation(history);
    const switchPrediction = history.length < 5 ? (history[history.length - 1].ket_qua === 'Tài' ? 2 : 1) : recentSwitch(history);
    const bridgePrediction = history.length < 5 ? { 'prediction': (history[history.length - 1].ket_qua === 'Tài' ? 2 : 1), 'breakProb': 0, 'reason': 'Lịch sử ngắn, dự đoán ngược lại' } : smartBridgeBreak(history);
    const vannhatPrediction = vannhatLogic(history);
    
    modelPredictions['trend'][lastSession] = trendPrediction;
    modelPredictions['short'][lastSession] = shortPrediction;
    modelPredictions['mean'][lastSession] = meanPrediction;
    modelPredictions['switch'][lastSession] = switchPrediction;
    modelPredictions['bridge'][lastSession] = bridgePrediction.prediction;
    
    const modelWeights = {
        'trend': evaluateModelPerformance(history, 'trend'),
        'short': evaluateModelPerformance(history, 'short'),
        'mean': evaluateModelPerformance(history, 'mean'),
        'switch': evaluateModelPerformance(history, 'switch'),
        'bridge': evaluateModelPerformance(history, 'bridge')
    };
    
    const scaledWeights = {
        'trend': 0.2 * modelWeights['trend'],
        'short': 0.2 * modelWeights['short'],
        'mean': 0.25 * modelWeights['mean'],
        'switch': 0.2 * modelWeights['switch'],
        'bridge': 0.15 * modelWeights['bridge'],
        'vannhat': 0.2
    };
    
    let xiuWeight = 0;
    let taiWeight = 0;
    
    if (trendPrediction === 1) xiuWeight += scaledWeights['trend'];
    else if (trendPrediction === 2) taiWeight += scaledWeights['trend'];
    
    if (shortPrediction === 1) xiuWeight += scaledWeights['short'];
    else if (shortPrediction === 2) taiWeight += scaledWeights['short'];
    
    if (meanPrediction === 1) xiuWeight += scaledWeights['mean'];
    else if (meanPrediction === 2) taiWeight += scaledWeights['mean'];
    
    if (switchPrediction === 1) xiuWeight += scaledWeights['switch'];
    else if (switchPrediction === 2) taiWeight += scaledWeights['switch'];
    
    if (bridgePrediction.prediction === 1) xiuWeight += scaledWeights['bridge'];
    else if (bridgePrediction.prediction === 2) taiWeight += scaledWeights['bridge'];
    
    if (vannhatPrediction.prediction === 'Tài') taiWeight += scaledWeights['vannhat'];
    else xiuWeight += scaledWeights['vannhat'];
    
    if (isBadPattern(history)) {
        console.log('Bad pattern detected, reducing confidence');
        xiuWeight *= 0.8;
        taiWeight *= 0.8;
    }
    
    const recentTen = history.slice(-10).map(entry => entry.ket_qua);
    const taiInRecentTen = recentTen.filter(result => result === 'Tài').length;
    if (taiInRecentTen >= 7) {
        taiWeight += 0.15;
        console.log('Adjusting for too many Tài predictions');
    } else if (taiInRecentTen <= 3) {
        xiuWeight += 0.15;
        console.log('Adjusting for too many Xỉu predictions');
    }
    
    if (bridgePrediction.breakProb > 0.65) {
        console.log('High bridge break probability:', bridgePrediction.breakProb, bridgePrediction.reason);
        if (bridgePrediction.prediction === 1) taiWeight += 0.2;
        else if (bridgePrediction.prediction === 2) xiuWeight += 0.2;
    }
    
    let finalPrediction;
    let finalReason;
    let confidence;
    
    const totalWeight = taiWeight + xiuWeight;
    if (totalWeight === 0) {
        finalPrediction = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        finalReason = '[Final] Trọng số cân bằng, dự đoán ngẫu nhiên';
        confidence = 0.5;
    } else if (taiWeight > xiuWeight) {
        finalPrediction = 'Tài';
        finalReason = '[Final] Dự đoán Tài với tổng trọng số ' + taiWeight.toFixed(2) + ' so với ' + xiuWeight.toFixed(2) + ' của Xỉu';
        confidence = (taiWeight / totalWeight);
    } else {
        finalPrediction = 'Xỉu';
        finalReason = '[Final] Dự đoán Xỉu với tổng trọng số ' + xiuWeight.toFixed(2) + ' so với ' + taiWeight.toFixed(2) + ' của Tài';
        confidence = (xiuWeight / totalWeight);
    }
    
    console.log('Prediction:', finalPrediction);
    console.log('Reason:', finalReason);
    
    return { prediction: finalPrediction, confidence: confidence, reason: finalReason };
}

// Định nghĩa endpoint API mới
app.get('/api/taixiu-predict', async (req, res) => {
    try {
        // 1. Gọi API gốc để lấy dữ liệu lịch sử
        const response = await axios.get('https://binhtool90-hitclub-predict.onrender.com/api/taixiu');
        const historyData = response.data;
        
        if (!historyData || historyData.length === 0) {
            return res.status(500).json({ error: 'Không thể lấy dữ liệu lịch sử từ API gốc.' });
        }
        
        // 2. Chạy thuật toán dự đoán của bạn
        const lastSessionData = historyData[historyData.length - 1];
        const { prediction, confidence, reason } = generatePrediction(historyData, modelPredictions);
        
        const predictionResult = prediction === 'Tài' ? 2 : 1;

        // 3. Chuẩn bị phản hồi theo định dạng mong muốn
        const responseData = {
            phien_truoc: lastSessionData.Phien,
            xuc_xac: `[ ${lastSessionData.xuc_xac.join(' - ')} ]`,
            tong: lastSessionData.Tong,
            ket_qua: lastSessionData.Ket_qua,
            phien_sau: lastSessionData.Phien + 1,
            du_doan: predictionResult,
            do_tin_cay: `${(confidence * 100).toFixed(2)}%`,
            giai_thich: reason,
            id: 'Tele@CsTool001'
        };

        // Gửi phản hồi
        res.json(responseData);
    } catch (error) {
        console.error('Error fetching data or generating prediction:', error);
        res.status(500).json({ error: 'Đã xảy ra lỗi khi xử lý yêu cầu.' });
    }
});

// Khởi động máy chủ
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
