from blackpy import Actor, stage

stage.background("dance")
dancer = Actor("cat", x=0, y=0, name="춤추는 고양이")

stage.say("고양이의 춤을 따라 해 봐요!")

for i in range(4):
    dancer.forward(90)
    dancer.backward(90)
    dancer.right(90)

stage.say("나만의 춤이 완성됐어요!")
print("고양이는 어느 쪽으로 돌았나요?")
