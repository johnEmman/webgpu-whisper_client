import { Server } from "socket.io";
import { Socket } from "socket.io-client";

const SocketHandler = (req: any, res: any) => {
  if (req.socket.Server.io) {
    console.log("socker is running!");
  } else {
    const io = new Server(req.socket.Server);
    req.socket.Server.io = io;

    io.on("connection", (socket) => {
      console.log("server is connected");
    });
  }
  res.end();
};

export default SocketHandler;
