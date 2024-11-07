"use client"; // This tells Next.js to treat this as a client-side component

import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

// Replace with your backend URL
const SERVER_URL = "http://localhost:5000";

interface SignalData {
  type: "offer" | "answer"; // Restrict to "offer" or "answer"
  sdp: string;
}

export default function AudioCall() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [caller, setCaller] = useState<string | null>(null);
  const [signalData, setSignalData] = useState<SignalData | null>(null);
  const [calling, setCalling] = useState(false);
  const [users, setUsers] = useState<string[]>([]); // List of available users

  const userVideo = useRef<HTMLVideoElement>(null); // User's video
  const partnerVideo = useRef<HTMLVideoElement>(null); // Partner's video

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidate[]>([]); // Queue to store ICE candidates

  useEffect(() => {
    socketRef.current = io(SERVER_URL);

    socketRef.current.on("connect", () => {
      socketRef.current?.emit("register", socketRef.current?.id); // Register the user ID with the server
      console.log(`Connected to server. My ID: ${socketRef.current?.id}`);
    });

    socketRef.current.on("userList", (userList: string[]) => {
      setUsers(userList); // Update the list of users
      console.log("User list updated:", userList);
    });

    socketRef.current.on(
      "callIncoming",
      (data: { from: string; signal: SignalData }) => {
        console.log("Received incoming call from", data.from);
        setCaller(data.from); // Set the caller's ID
        setSignalData(data.signal); // Set the signal data (offer from the caller)

        // If the signal data is valid, proceed to answer
        if (data.signal) {
          setSignalData(data.signal);
        } else {
          console.error("Signal data is missing when answering the call.");
        }
      }
    );
    socketRef.current.on("callAccepted", (data: { signal: SignalData }) => {
      setCallAccepted(true);
      setSignalData(data.signal); // Update the signal data from the callee
      console.log("Call accepted. Signal:", data.signal);
    });

    socketRef.current.on(
      "newICECandidate",
      (candidate: RTCIceCandidateInit) => {
        console.log("New ICE Candidate:", candidate);
        if (candidate && peerConnection.current) {
          if (peerConnection.current.remoteDescription) {
            // If remote description is already set, add the ICE candidate
            peerConnection.current.addIceCandidate(
              new RTCIceCandidate(candidate)
            );
            console.log("Added ICE Candidate directly.");
          } else {
            // Otherwise, queue the ICE candidate
            iceCandidateQueue.current.push(new RTCIceCandidate(candidate));
            console.log("Queued ICE Candidate.");
          }
        }
      }
    );

    return () => {
      socketRef.current?.disconnect();
      console.log("Disconnected from server.");
    };
  }, []);

  // Start a call
  // In the startCall method
  const startCall = (targetId: string) => {
    console.log(`Starting call to ${targetId}...`);
    setCalling(true);
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((userStream) => {
        setStream(userStream);
        if (userVideo.current) {
          userVideo.current.srcObject = userStream; // Set user's own video stream
        }

        peerConnection.current = new RTCPeerConnection();
        console.log("Created peer connection for calling.");

        peerConnection.current.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("Sending ICE Candidate:", event.candidate);
            socketRef.current?.emit("sendCandidate", targetId, event.candidate);
          }
        };

        peerConnection.current.ontrack = (event) => {
          console.log("Received track after calling:", event);
          if (partnerVideo.current) {
            partnerVideo.current.srcObject = event.streams[0]; // Set partner's video stream
          }
        };

        // Add local stream tracks to the peer connection
        userStream.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, userStream);
        });

        // Create offer
        peerConnection.current
          .createOffer()
          .then((offer) => {
            console.log("Created offer:", offer);
            return peerConnection.current?.setLocalDescription(offer);
          })
          .then(() => {
            // Emit the call with offer signal
            socketRef.current?.emit(
              "callUser",
              targetId,
              peerConnection.current?.localDescription
            );
          })
          .catch((err) => console.error("Error creating offer:", err));
      })
      .catch((err) => console.error("Error accessing media devices:", err));
  };
  // Answer an incoming call
  const answerCall = () => {
    if (!signalData) {
      console.error("Signal data is missing when answering the call.");
      return;
    }

    console.log(`Answering call from ${caller}...`);
    setCallAccepted(true);

    // Get media (video and audio) for the receiver
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((userStream) => {
        setStream(userStream);
        if (userVideo.current) {
          userVideo.current.srcObject = userStream; // Set user's own video stream
        }

        peerConnection.current = new RTCPeerConnection();
        console.log("Created peer connection for answering.");

        peerConnection.current.onicecandidate = (event) => {
          if (event.candidate) {
            console.log("Sending ICE Candidate:", event.candidate);
            socketRef.current?.emit("sendCandidate", caller!, event.candidate);
          }
        };

        peerConnection.current.ontrack = (event) => {
          console.log("Received track after answering:", event);
          if (partnerVideo.current) {
            partnerVideo.current.srcObject = event.streams[0]; // Set partner's video stream
          }
        };

        peerConnection.current
          .setRemoteDescription(
            new RTCSessionDescription(signalData as RTCSessionDescriptionInit)
          ) // Casting the SignalData
          .then(() => {
            console.log("Set remote description.");
            // After setting the remote description, process any queued ICE candidates
            iceCandidateQueue.current.forEach((candidate) => {
              peerConnection.current?.addIceCandidate(candidate);
              console.log("Added queued ICE Candidate.");
            });
            iceCandidateQueue.current.length = 0; // Clear the candidate queue
          })
          .then(() => peerConnection.current?.createAnswer())
          .then((answer) => {
            console.log("Created answer:", answer);
            return peerConnection.current?.setLocalDescription(answer);
          })
          .then(() => {
            socketRef.current?.emit(
              "answerCall",
              caller!,
              peerConnection.current?.localDescription
            );
            console.log("Answer sent to the caller.");
          })
          .catch((err) => console.error("Error answering call", err));

        // Add local stream tracks to the peer connection
        userStream.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, userStream);
        });
      })
      .catch((err) => console.error("Error accessing media devices:", err));
  };

  return (
    <div>
      <h2>WebRTC Audio/Video Call</h2>
      <div>
        <video ref={userVideo} autoPlay muted />
        <video ref={partnerVideo} autoPlay />
      </div>
      <div>
        {!callAccepted && !calling && (
          <div>
            <h3>Available Users</h3>
            {users.map((user) => (
              <button key={user} onClick={() => startCall(user)}>
                Call {user}
              </button>
            ))}
          </div>
        )}
        {calling && <p>Calling...</p>}
        {caller && !callAccepted && !calling && (
          <div>
            <h3>Incoming call from {caller}</h3>
            <button onClick={answerCall}>Answer</button>
          </div>
        )}
      </div>
    </div>
  );
}
