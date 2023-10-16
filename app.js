const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();
const bcrypt = require("bcrypt");
const dbPath = path.join(__dirname, "twitterClone.db");

app.use(express.json());
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3002, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

//API-1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const getCurrentData = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getCurrentData);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const postData = `INSERT INTO user (username,password,name,gender)
      VALUES ('${username}','${hashedPassword}','${name}','${gender}')`;
      const dbResponse = await db.run(postData);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API-2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const checkPassword = await bcrypt.compare(password, dbUser.password);
    if (checkPassword) {
      response.status(200);
      const payload = { username: username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(dbUser, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API-3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { userId, name, username, gender } = request;
  console.log(userId);
  const topData = `
  SELECT 
  
  user.username,
  tweet.tweet,
  tweet.date_time AS dateTime
   from
   follower
   left join tweet on tweet.user_id = follower.following_user_id
   left join user on follower.following_user_id = user.user_id
   WHERE 
   follower.follower_user_id = (select user_id from user WHERE username = '${request.username}')
   ORDER BY tweet.date_time desc
   limit 4 ;
  `;
  const dbResponse = await db.all(topData);
  console.log(dbResponse);
  response.send(dbResponse);
});

//API-4 Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  //const { user_id, name, username, gender } = payload;
  const userFollowsQuery = `SELECT user.name FROM
   follower  INNER JOIN user ON
   user.user_id = follower.following_user_id
  WHERE 
  follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;
  const dbResponse = await db.all(userFollowsQuery);
  console.log(dbResponse);
  response.send(dbResponse);
});

//API-5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowersQuery = `SELECT  user.name FROM
    follower LEFT JOIN user ON 
    user.user_id =  follower.follower_user_id
    WHERE 
    follower.following_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;

  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});

const followsAuth = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  let isFollowing = await db.get(`
    SELECT * FROM tweet INNER JOIN follower ON tweet.user_id= follower.following_user_id
    WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}'
    `);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API-6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  followsAuth,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const tweetsQuery = `SELECT tweet, (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}'
    ) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}')AS replies,
    date_time AS dateTime FROM 
    tweet 
    WHERE tweet.tweet_id = '${tweetId}'; `;
    const tweetResult = await db.get(tweetsQuery);
    response.send(tweetResult);
  }
);

//API-7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  followsAuth,
  async (request, response) => {
    //If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
    const { tweetId } = response.params;
    const likedByQuery = `SELECT user.username FROM like NATURAL JOIN user 
    WHERE tweet_id = ${tweetId}`;
    const likedBy = await db.all(likedByQuery);
    response.send(likedBy);
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  followsAuth,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(`
    SELECT user.name,reply.reply FROM reply NATURAL JOIN user
    WHERE tweet_id = ${tweetId}`);
    response.send({ replies });
  }
);

//API-9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetDetailsQuery = `SELECT tweet ,
    COUNT (DISTINCT like_id ) AS likes,
    COUNT (DISTINCT reply_id) AS replies,
    date_time AS dateTime 
    FROM tweet LEFT JOIN 
    reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN
    like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = '${userId}'
    GROUP BY tweet.tweet_id ;`;
  const tweetDetails = await db.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

//API-10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { userId } = parseInt(request.user_id);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const postQuery = `INSERT INTO tweet(tweet,user_id,date_time)
    VALUES ('${tweet}','${userId}','${dateTime}');`;
  await db.run(postQuery);
  response.send("Created a Tweet");
});

//API-11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const selectUserQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND  tweet_id = '${tweetId}';`;
    const tweetUser = await db.get(selectUserQuery);
    console.log(tweetUser);
    if (tweetUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}'`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
